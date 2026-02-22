# Discord Invite Tracker Bot 🤖

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=flat&logo=bun&logoColor=white)](https://bun.sh)
[![Discord.js](https://img.shields.io/badge/discord.js-v14-blue.svg?logo=discord&logoColor=white)](https://discord.js.org)

A high-performance Discord bot built with **Bun** and **discord.js v14** to track user-generated invites, validate joins based on server stay duration (default: 7 days), and manage a leaderboard. Optimized with **SQLite** for lightweight and reliable data management.

---

## ✨ Core Features

*   **⚡ High Performance:** Powered by the **Bun** runtime and native **SQLite** driver.
*   **🔗 Personal Invite Links:** Users generate unique, permanent server invites via the `/invite` command.
*   **⏳ Intelligent Validation:** Tracks "Pending" joins and automatically validates them after the user stays for a configurable period (default: 7 days).
*   **📉 Real-time Stats:** `/invite` shows the user's link, validated invites, and pending counts.
*   **🏆 Leaderboard:** `/leaderboard` ranks the top inviters based on *validated* successful joins.
*   **🛡️ Admin Tools:** `/check <user>` allows administrators to inspect any user's invite statistics.
*   **🌍 Multi-language Support:** Fully customizable translations via `custom-lang.yaml`.
*   **🧹 Automatic Cleanup:** Detects deleted invites on Discord and syncs the database.

---

## 💻 Technology Stack

*   **Runtime:** [Bun](https://bun.sh) (v1.0.0+)
*   **Library:** discord.js v14
*   **Database:** SQLite (via native `bun:sqlite` — zero external DB dependencies)
*   **Configuration:** dotenv (for environment variables)
*   **Translations:** js-yaml (YAML-based internationalization)

---

## ✅ Prerequisites

*   **Bun Runtime:** Installed on your system ([Installation Guide](https://bun.sh/docs/installation)).
*   **Discord Bot Application:** Created via the [Discord Developer Portal](https://discord.com/developers/applications).

---

## 🛠️ Setup & Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/your-username/invite-tracker.git
    cd invite-tracker
    ```

2.  **Install Dependencies:**
    ```bash
    bun install
    ```

3.  **Discord Bot Configuration:**
    *   Create a "New Application" in the portal.
    *   Under the **Bot** tab, enable **Privileged Gateway Intents**:
        *   `GUILD_MEMBERS` (**CRITICAL** for tracking joins/leaves).
    *   Reset/Copy the **Bot Token**.
    *   Under **OAuth2**, copy the **Client ID** (Application ID).

4.  **Environment Setup:**
    Create a `.env` file in the project root:
    ```dotenv
    # --- Discord Credentials ---
    DISCORD_TOKEN=your_bot_token_here
    CLIENT_ID=your_client_id_here

    # --- Admin Access ---
    # Comma-separated list of Discord User IDs allowed to use /check
    ADMIN_IDS=123456789012345678,987654321098765432

    # --- Localization ---
    # 'en' or 'custom' (uses custom-lang.yaml)
    LOCALE_LANG=en

    # --- Optional Settings ---
    # TEST_GUILD_ID=your_guild_id_here (for instant slash command updates)
    # LOG_LEVEL=INFO (DEBUG | INFO | WARN | ERROR)
    # VALIDATION_PERIOD_DAYS=7
    # VALIDATION_CHECK_INTERVAL_MINUTES=60
    # PERFORM_GUILD_DELETE_CLEANUP=false
    ```

5.  **Deploy Slash Commands:**
    ```bash
    bun run deploy
    ```

---

## 🚀 Running the Bot

**Development Mode (with hot reload):**
```bash
bun run dev
```

**Production Mode:**
```bash
bun run start
```

---

## 📂 Project Structure

- `index.js`: Main entry point and Discord client event handlers.
- `database/db.js`: Centralized SQLite interface using `bun:sqlite`.
- `commands/`: Individual slash command definitions (`invite`, `leaderboard`, `check`).
- `utils/logger.js`: Shared logging utility with configurable levels.
- `utils/translator.js`: Localization helper for `custom-lang.yaml`.
- `config.js`: Non-sensitive runtime configuration (colors, limits).

---

## 🎮 Usage

| Command | Description |
| :--- | :--- |
| `/invite` | Shows your unique link and your invite stats. |
| `/leaderboard` | Displays the top server inviters. |
| `/check <user>` | **[Admin]** View stats for a specific member. |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to open issues or submit pull requests to improve the project.

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.