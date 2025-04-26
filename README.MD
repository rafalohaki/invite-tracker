# Discord Invite Tracker Bot

A Discord bot built with Node.js and discord.js v14 to track user-generated invite links, validate new member joins based on server stay duration, and display a leaderboard of top inviters.

## Features

*   **Personal Invite Links:** Users can generate their own unique, permanent invite link using the `/invite` command.
*   **Validated Invite Tracking:** The bot tracks users who join via these links and automatically validates the invite if the new member stays in the server for a configurable duration (default: 1 week).
*   **Invite Count Display:** The `/invite` command also shows the user how many *validated* invites they have.
*   **Invite Leaderboard:** The `/leaderboard` command displays the top users based on their validated invite count.
*   **Automatic Link Management:** If a user's stored invite link becomes invalid (deleted/expired), the `/invite` command will automatically generate a new one. Stale invite records are also cleaned up during member join events.
*   **Leave Tracking:** If a user leaves before the validation period, their join status is marked accordingly (`left_early`).
*   **Robust & Configurable:** Uses MongoDB for persistence, environment variables for sensitive configuration, and a `config.js` file for customization.

## Technology Stack

*   **Node.js** (v16.9.0 or newer required)
*   **discord.js v14**
*   **Mongoose** (MongoDB ODM)
*   **MongoDB** (Database)
*   **dotenv** (Environment variable management)

## Prerequisites

*   Node.js (v16.9.0 or later) installed: [https://nodejs.org/](https://nodejs.org/)
*   npm (usually included with Node.js)
*   Access to a MongoDB database instance (local or cloud-based like MongoDB Atlas). Get the connection string (URI).
*   A Discord account.

## Setup & Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/rafalohaki/invite-tracker
    cd invite-tracker
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Create Discord Bot Application:**
    *   Go to the [Discord Developer Portal](https://discord.com/developers/applications).
    *   Click "New Application".
    *   Give it a name (e.g., "Invite Tracker").
    *   Go to the "Bot" tab.
    *   Click "Add Bot", then "Yes, do it!".
    *   **Important: Enable Privileged Gateway Intents:**
        *   Scroll down to "Privileged Gateway Intents".
        *   Enable **`GUILD_MEMBERS`** (Server Members Intent). This is crucial for tracking joins/leaves.
        *   Ensure `MESSAGE_CONTENT` is likely *not* needed based on the current commands, but enable if future text commands require it. The bot primarily uses slash commands.
    *   **Copy the Bot Token:** Under the bot's username, click "Reset Token" (or "View Token") and copy it securely. **Do not share this token!**
    *   **Copy the Client ID:** Go to the "OAuth2" -> "General" tab and copy the "Application ID" (this is your Client ID).

4.  **Configure Environment Variables:**
    *   Create a file named `.env` in the root directory (`invite-tracker`).
    *   Add the following variables, replacing the placeholders with your actual values:

    ```dotenv
    # .env

    # Your Discord Bot Token (from Developer Portal -> Bot tab)
    DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE

    # Your Bot's Application/Client ID (from Developer Portal -> OAuth2 -> General tab)
    CLIENT_ID=YOUR_CLIENT_ID_HERE

    # Your MongoDB Connection String (URI)
    # Example for local: mongodb://localhost:27017/invite-tracker
    # Example for Atlas: mongodb+srv://<username>:<password>@<cluster-url>/<database-name>?retryWrites=true&w=majority
    MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING_HERE

    # --- Optional ---

    # For faster command testing/updates, uncomment and set to your Test Server's ID.
    # Commands will register instantly ONLY in this guild. Remove/comment out for global deployment.
    # TEST_GUILD_ID=YOUR_TEST_SERVER_ID_HERE

    # Override the default 7-day validation period (value in days)
    # VALIDATION_PERIOD_DAYS=1

    # Override the default 60-minute interval for checking pending joins (value in minutes)
    # VALIDATION_CHECK_INTERVAL_MINUTES=30

    # Set to 'true' to enable automatic deletion of DB records when the bot leaves a guild (Use with caution!)
    # PERFORM_GUILD_DELETE_CLEANUP=false
    ```

5.  **Invite the Bot to Your Server:**
    *   Go back to the Discord Developer Portal -> Your Application -> "OAuth2" -> "URL Generator".
    *   Select the following scopes:
        *   `bot`
        *   `application.commands` (**Crucial for slash commands to work!**)
    *   Select the necessary Bot Permissions:
        *   `Manage Guild` (Required for fetching all invites to compare usage)
        *   `Create Instant Invite` (Required for the `/invite` command)
        *   `Send Messages`
        *   `Embed Links`
        *   `Read Message History` (Generally good to have)
        *   *Add any other permissions needed by potential future features.*
    *   Copy the generated URL.
    *   Paste the URL into your browser and select the server you want to add the bot to. Authorize the bot.

6.  **Deploy Slash Commands:**
    *   Open your terminal in the project directory (`invite-tracker`).
    *   Run the deployment script:
        ```bash
        node deploy-commands.js
        ```
    *   **Note:** If you **did not** set `TEST_GUILD_ID` in `.env`, commands are deployed globally and can take **up to 1 hour** to appear in all servers. If you *did* set `TEST_GUILD_ID`, commands should appear almost instantly *only in that specific server*.

7.  **Run the Bot:**
    ```bash
    node index.js
    ```
    *   You should see logs indicating successful login, database connection, and readiness.

## Configuration

*   **`.env` File:** Used for sensitive credentials and deployment settings (see Setup step 4).
*   **`config.js`:** Contains less sensitive, general configuration:
    *   `leaderboard.limit`: Max users shown on the leaderboard.
    *   `leaderboard.embedColor`: Embed color for the leaderboard command.
    *   `inviteCommand.embedColor`: Embed color for the invite command.
    *   `defaultValidationPeriodDays`: Default days a user must stay (can be overridden by `VALIDATION_PERIOD_DAYS` in `.env`).
    *   `defaultValidationCheckIntervalMinutes`: Default interval for the validation task (can be overridden by `VALIDATION_CHECK_INTERVAL_MINUTES` in `.env`).

## Usage

The bot uses slash commands:

*   `/invite`:
    *   Shows your personal, permanent invite link for the server.
    *   Displays the number of members who joined using your link *and* stayed for the validation period.
    *   If you don't have a link or yours is invalid, it generates a new one automatically.

*   `/leaderboard`:
    *   Displays a list of the top members ranked by their validated invite count.

## Deployment Notes

*   Run `node deploy-commands.js` whenever you add or modify slash command definitions (`data` export in command files).
*   Use the `TEST_GUILD_ID` environment variable for rapid testing during development. Remove or comment it out for production deployment to make commands available globally (allow up to 1 hour for propagation).

## Contributing

Contributions are welcome! Please feel free to fork the repository, make changes, and submit a pull request.

## License

[Specify your license here, e.g., MIT] (Or: See the LICENSE file for details.)