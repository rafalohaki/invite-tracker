# Discord Invite Tracker Bot 🤖

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Node.js/discord.js v14 bot to track user-generated invites, validate joins based on server stay duration (default: 1 week), and display a leaderboard.

## ✨ Core Features

*   **Personal Invite Links:** Users generate unique, permanent server invites via `/invite`.
*   **Validated & Pending Counts:** `/invite` shows the user's link, validated invites (stayed > 1 week), and pending invites (joined, awaiting validation).
*   **Invite Leaderboard:** `/leaderboard` ranks users by *validated* invite count.
*   **Smart Link Management:** Auto-generates new links via `/invite` if the previous one is invalid.
*   **Accurate Join/Leave Tracking:** Attributes joins via invite usage comparison and handles members leaving before validation (`left_early`).
*   **Periodic Validation:** Automatically checks and updates the status of pending joins.
*   **Reliable & Configurable:** Uses MongoDB, `.env` for secrets, and `config.js` for settings.

## 💻 Technology Stack

*   **Runtime:** Node.js (v16.9.0 or newer recommended)
*   **Library:** discord.js v14
*   **Database:** MongoDB (via Mongoose ODM)
*   **Configuration:** dotenv (for environment variables)

## ✅ Prerequisites

*   **Node.js:** v16.9.0+ ([Download](https://nodejs.org/))
*   **npm:** Included with Node.js.
*   **MongoDB:** Access to a MongoDB instance and its connection string (URI).
*   **Discord Account:** For bot application creation.

## 🛠️ Setup & Installation

1.  **Clone:**
    ```bash
    git clone https://github.com/your-username/dcinvitetracker # Replace with your repo URL if forked
    cd dcinvitetracker
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Create Discord Bot Application:**
    *   Go to [Discord Developer Portal](https://discord.com/developers/applications).
    *   Create "New Application".
    *   Go to "**Bot**" tab -> "**Add Bot**".
    *   **🚨 Enable Privileged Gateway Intents:**
        *   `GUILD_MEMBERS` (**Required** for join/leave detection).
        *   `MESSAGE_CONTENT` (Optional, likely not needed).
    *   **🔑 Copy Bot Token:** Reset/View Token -> Copy securely.
    *   **📋 Copy Client ID:** Go to "**OAuth2**" -> "**General**" -> Copy "**Application ID**".

4.  **Configure Environment Variables:**
    *   Create `.env` file in the project root.
    *   Add necessary variables (see below). **Keep this file secure!**

    ```dotenv
    # .env

    DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
    CLIENT_ID=YOUR_CLIENT_ID_HERE
    MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING_HERE

    # --- Optional ---
    # TEST_GUILD_ID=YOUR_TEST_SERVER_ID_HERE # For faster command testing
    # VALIDATION_PERIOD_DAYS=7
    # VALIDATION_CHECK_INTERVAL_MINUTES=60
    # PERFORM_GUILD_DELETE_CLEANUP=false # Set true to delete DB data on guild leave
    ```

5.  **Invite Bot to Server:**
    *   Go to Developer Portal -> Your App -> "**OAuth2**" -> "**URL Generator**".
    *   **Scopes**: `bot`, `application.commands` (Required).
    *   **Bot Permissions**:
        *   `Manage Guild` (Required for accurate invite fetching).
        *   `Create Instant Invite` (Required for `/invite`).
        *   `Send Messages`, `Embed Links`, `Read Message History`.
    *   Copy generated URL -> Paste in browser -> Authorize bot on your server.

6.  **Deploy Slash Commands:**
    ```bash
    node deploy-commands.js
    ```
    *   **Global:** No `TEST_GUILD_ID` set (up to 1 hour propagation).
    *   **Test Guild:** `TEST_GUILD_ID` set (near-instant update in that guild only).

7.  **Run the Bot:**
    ```bash
    node index.js
    ```

## ⚙️ Configuration

*   **`.env`:** Sensitive credentials (Token, DB URI), deployment settings (Test Guild ID, optional overrides). **Private!**
*   **`config.js`:** Non-sensitive settings (leaderboard limit/color, invite embed color, default validation/check intervals).

## 🎮 Usage

*   `/invite`: Shows your invite link, validated (stayed > 1 week) & pending counts. Auto-generates link if needed.
*   `/leaderboard`: Displays top users by validated invite count.

## 💡 Deployment Notes

*   Run `node deploy-commands.js` after adding/modifying commands.
*   Use `TEST_GUILD_ID` for development, remove/comment for global deployment.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome via forks and pull requests.

## 📜 License

MIT License - see the [LICENSE](LICENSE) file.