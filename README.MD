# Discord Invite Tracker Bot 🤖

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Node.js/discord.js v14 bot to track user-generated invites, validate joins based on server stay duration (default: 1 week), and display a leaderboard. Supports custom language translation via YAML.

## ✨ Core Features

*   **Personal Invite Links:** Users generate unique, permanent server invites via `/invite`.
*   **Validated & Pending Counts:** `/invite` shows the user's link, validated invites (stayed > 1 week), and pending invites (joined, awaiting validation).
*   **Invite Leaderboard:** `/leaderboard` ranks users by *validated* invite count.
*   **Smart Link Management:** Auto-generates new links via `/invite` if the previous one is invalid.
*   **Accurate Join/Leave Tracking:** Attributes joins via invite usage comparison and handles members leaving before validation (`left_early`).
*   **Periodic Validation:** Automatically checks and updates the status of pending joins.
*   **Reliable & Configurable:** Uses MongoDB, `.env` for secrets, and `config.js` for settings.
*   **🌍 Customizable Language:** User-facing text can be customized/translated via `custom-lang.yaml`.

## 💻 Technology Stack

*   **Runtime:** Node.js (v16.9.0 or newer recommended)
*   **Library:** discord.js v14
*   **Database:** MongoDB (via Mongoose ODM)
*   **Configuration:** dotenv (for environment variables)
*   **Translations:** js-yaml (for parsing `custom-lang.yaml`)

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
    *(This installs discord.js, mongoose, dotenv, js-yaml, etc.)*

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
    *   Create a `.env` file in the project root (you can copy/rename `.env.example` if one exists, or create it manually).
    *   Add necessary variables (see below). **Keep this file secure!**

    ```dotenv
    # .env

    # --- Core Settings ---
    DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
    CLIENT_ID=YOUR_CLIENT_ID_HERE
    MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING_HERE # e.g., mongodb://user:pass@host:port/db
    ADMIN_IDS=YOUR_ADMIN_ID_1,YOUR_ADMIN_ID_2 # Comma-separated Discord User IDs for admin commands (no spaces!)

    # --- Language Configuration ---
    # Set to 'custom' to use translations from the 'custom:' section in custom-lang.yaml (falls back to 'en' for missing keys).
    # Set to 'en' (or leave blank/comment out) to use only the default 'en:' section from custom-lang.yaml.
    LOCALE_LANG=custom

    # --- Optional Settings ---
    # TEST_GUILD_ID=YOUR_TEST_SERVER_ID_HERE # For faster command testing/deployment
    # VALIDATION_PERIOD_DAYS=7               # Override default 7 days stay requirement
    # VALIDATION_CHECK_INTERVAL_MINUTES=60   # Override default 60 min validation check
    # PERFORM_GUILD_DELETE_CLEANUP=false     # Set true to delete DB data when bot leaves guild
    ```

5.  **Customize Language (Optional):**
    *   Edit the `dcinvitetracker/custom-lang.yaml` file.
    *   Modify the strings under the `custom:` section for your desired language.
    *   Use the `en:` section as a reference for keys and placeholders (e.g., `{variable_name}`). The structure (like `invite.embed_title`) must match.
    *   Ensure `LOCALE_LANG=custom` is set in your `.env` file to activate these custom translations. If `LOCALE_LANG` is set to `en` or is missing, only the `en:` section will be used.

6.  **Invite Bot to Server:**
    *   Go to Developer Portal -> Your App -> "**OAuth2**" -> "**URL Generator**".
    *   **Scopes**: `bot`, `application.commands` (Required).
    *   **Bot Permissions**:
        *   `Manage Guild` (Required for accurate invite fetching/tracking).
        *   `Create Instant Invite` (Required for the `/invite` command).
        *   `Send Messages`, `Embed Links`, `Read Message History` (Basic functionality).
    *   Copy the generated URL -> Paste it in your browser -> Select your server and authorize the bot.

7.  **Deploy Slash Commands:**
    ```bash
    node deploy-commands.js
    ```
    *   **Global Deployment:** If `TEST_GUILD_ID` is *not* set in `.env`, commands deploy globally (updates can take up to 1 hour).
    *   Make sure the bot has the `application.commands` scope when invited.
    *   **Test Guild Deployment:** If `TEST_GUILD_ID` *is* set in `.env`, commands deploy only to that specific guild (updates are near-instant). Recommended for development.

8.  **Run the Bot:**
    ```bash
    npm start # Uses the script defined in package.json
    # Or alternatively: node index.js
    ```

## ⚙️ Configuration Summary

*   **`.env`:** Contains sensitive credentials (Bot Token, DB URI), your Admin ID(s) (`ADMIN_IDS`), the target language setting (`LOCALE_LANG`), deployment settings (Test Guild ID), and optional behavioral overrides (validation period, cleanup). **Keep Private!**
*   **`custom-lang.yaml`:** Stores all user-facing text strings. Edit the `custom:` section for your own translations/phrasing. Requires `LOCALE_LANG=custom` in `.env` to be active (uses `en:` as fallback). If `LOCALE_LANG` is `en` or missing, only `en:` is used.
*   **`config.js`:** Contains non-sensitive, general bot settings like embed colors and default limits/intervals that are less likely to change per deployment.

## 🎮 Usage

*   `/invite`: Shows your personal invite link, your validated invite count (users who joined via your link and stayed > 1 week), and your pending invite count (users who joined but haven't stayed 1 week yet). Automatically generates a new link if needed.
*   `/leaderboard`: Displays a ranked list of users based on their *validated* invite count.
*   `/check <user>`: **[Admin Only]** Displays the invite link, validated count, and pending count for the specified user. Requires your Discord ID to be listed in `ADMIN_IDS` in the `.env` file.

## 💡 Deployment Notes

*   Run `node deploy-commands.js` whenever you add or modify the *structure* (name, options, description) of slash commands defined in the `/commands` directory.
*   Use `TEST_GUILD_ID` in `.env` for faster development and testing command updates. Remove or comment it out for global production deployment.
*   Set `LOCALE_LANG` in `.env` to `en` or `custom` to control which language strings are used from `custom-lang.yaml`.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Please feel free to fork the repository, make changes, and submit pull requests. For major changes, please open an issue first to discuss what you would like to change.

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.