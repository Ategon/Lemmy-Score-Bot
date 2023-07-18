import LemmyBot from 'lemmy-bot';
import chalk from 'chalk';
import sqlite3 from 'sqlite3';
import { load } from 'js-yaml'
import 'dotenv/config';
import { readFileSync } from 'fs';

let { markAsBot, showLogs, instances, upvoteCheckInterval, timezone } = load(readFileSync('config.yaml', 'utf8'));

markAsBot = markAsBot ?? true;
showLogs = showLogs ?? false;
upvoteCheckInterval = upvoteCheckInterval ?? 10;
timezone = timezone ?? 'America/Toronto';

function log(message) {
    if (showLogs) {
        console.log(message);
    }
}

log(`${chalk.magenta('STARTED:')} Started Bot`)

// -----------------------------------------------------------------------------
// Databases

const db = new sqlite3.Database('mega.sqlite3', (err) => {
    if (err) {
        return console.error(err.message);
    }
    log(`${chalk.green('DB:')} Connected to the database.`);

    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY
    )`, (err) => {
        if (err) {
            return console.error(err.message);
        }
        log(`${chalk.grey('TABLE:')} Loaded posts table.`);
    });
});

// -----------------------------------------------------------------------------
// Main Bot Code

// Create the list of communities the bot will be interacting in
const allowList = []

for (const [instance, communities] of Object.entries(instances)) {
    allowList.push({
        instance: instance,
        communities: Object.keys(communities)
    })
}

// Log in
const bot = new LemmyBot.LemmyBot({
    instance: process.env.LEMMY_INSTANCE,
    credentials: {
        username: process.env.LEMMY_USERNAME,
        password: process.env.LEMMY_PASSWORD,
    },
    dbFile: 'db.sqlite3',
    federation: {
        allowList: allowList,
    },
    markAsBot: markAsBot,
    handlers: {
        post: {
            sort: 'New',
            handle: async ({
                postView: {
                    post,
                },
            }) => {
                // Add post to database
                db.run(`INSERT INTO posts (id) VALUES (?)`, [post.id], (err) => {
                    if (err) {
                        return console.error(err.message);
                    }
                    log(`${chalk.grey('DB:')} Added post ${post.id} to database.`);
                });
            }
        }
    },
    schedule: [
        {
            cronExpression: `0 */${upvoteCheckInterval} * * * *`,
            timezone: timezone,
            doTask: async ({createComment, getPost}) => {
                // Get all posts in db and check if they have been upvoted enough
                db.all(`SELECT * FROM posts`, [], async (err, rows) => {
                    if (err) {
                        return console.error(err.message);
                    }

                    for (let i = 0; i < rows.length; i++) {
                        const post = await getPost(rows[i].id);
                        if (!post) continue;

                        const instance = extractInstance(post.community.actor_id);
                        const community = instances[instance][post.community.name];

                        if (post.counts.score >= community.score) {
                            // Create comment
                            createComment({
                                post_id: post.id,
                                content: community.response
                            });

                            // Delete post from db
                            db.run(`DELETE FROM posts WHERE id = ?`, [post.id], (err) => {
                                if (err) {
                                    return console.error(err.message);
                                }
                                log(`${chalk.grey('DB:')} Removed post ${post.id} from database.`);
                            });
                        }
                    }
                });
            },
        },
        
    ],
});

function extractInstance(link) {
    const instanceName = new RegExp('.*\/\/(.*)\/c\/').exec(link)[1];

    return instanceName;
}


bot.start();