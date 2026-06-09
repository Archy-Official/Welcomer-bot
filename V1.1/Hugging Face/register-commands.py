import os
import sys
import requests

BOT_TOKEN      = os.getenv("DISCORD_BOT_TOKEN")
APPLICATION_ID = os.getenv("DISCORD_APPLICATION_ID")
GUILD_ID       = os.getenv("DISCORD_GUILD_ID")

if not all([BOT_TOKEN, APPLICATION_ID, GUILD_ID]):
    print("Missing required environment variables: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID")
    sys.exit(1)

headers = {
    "Authorization": f"Bot {BOT_TOKEN}",
    "Content-Type": "application/json",
}

commands = [
    {
        "name": "setup",
        "description": "Configure core server management channels and roles",
        "options": [
            {
                "name": "channels",
                "description": "Assign tracking channels",
                "type": 1,
                "options": [
                    {"name": "welcome-channel", "description": "Channel for greeting cards", "type": 7, "required": False},
                    {"name": "leave-channel",   "description": "Channel for goodbye cards",  "type": 7, "required": False},
                ],
            },
            {
                "name": "autorole-add",
                "description": "Add an auto-role",
                "type": 1,
                "options": [
                    {"name": "role", "description": "Target role", "type": 8, "required": True},
                ],
            },
            {
                "name": "autorole-remove",
                "description": "Remove an auto-role",
                "type": 1,
                "options": [
                    {"name": "role", "description": "Target role", "type": 8, "required": True},
                ],
            },
            {"name": "autorole-list", "description": "List configured auto-roles", "type": 1},
            {
                "name": "dm",
                "description": "Toggle welcome DMs for new members",
                "type": 1,
                "options": [
                    {"name": "enabled", "description": "Enable or disable", "type": 5, "required": True},
                ],
            },
        ],
    },
    {
        "name": "background",
        "description": "Configure card backgrounds",
        "options": [
            {
                "name": "default",
                "description": "Apply a built-in background style",
                "type": 1,
                "options": [
                    {
                        "name": "style",
                        "description": "Background style",
                        "type": 3,
                        "required": True,
                        "choices": [
                            {"name": "Default 1", "value": "default1"},
                            {"name": "Default 2", "value": "default2"},
                            {"name": "Default 3", "value": "default3"},
                        ],
                    },
                    {
                        "name": "type",
                        "description": "Card to apply to",
                        "type": 3,
                        "required": False,
                        "choices": [
                            {"name": "Welcome", "value": "welcome"},
                            {"name": "Leave",   "value": "leave"},
                            {"name": "Both",    "value": "both"},
                        ],
                    },
                ],
            },
            {
                "name": "upload",
                "description": "Upload a custom background image",
                "type": 1,
                "options": [
                    {
                        "name": "apply-to",
                        "description": "Card to apply to",
                        "type": 3,
                        "required": True,
                        "choices": [
                            {"name": "Welcome", "value": "welcome"},
                            {"name": "Leave",   "value": "leave"},
                            {"name": "Both",    "value": "both"},
                        ],
                    },
                    {"name": "name", "description": "Slot name (alphanumeric and dashes, max 20 chars)", "type": 3,  "required": True},
                    {"name": "file", "description": "Image file",                                        "type": 11, "required": True},
                ],
            },
            {
                "name": "switch",
                "description": "Switch the active background for a card",
                "type": 1,
                "options": [
                    {
                        "name": "type",
                        "description": "Card to update",
                        "type": 3,
                        "required": True,
                        "choices": [
                            {"name": "Welcome", "value": "welcome"},
                            {"name": "Leave",   "value": "leave"},
                        ],
                    },
                    {"name": "name", "description": "Background slot name", "type": 3, "required": True},
                ],
            },
            {
                "name": "delete",
                "description": "Delete a custom background slot",
                "type": 1,
                "options": [
                    {"name": "name", "description": "Background slot name", "type": 3, "required": True},
                ],
            },
            {"name": "list", "description": "List all background slots", "type": 1},
        ],
    },
    {
        "name": "welcome-message",
        "description": "Configure welcome message templates",
        "options": [
            {
                "name": "set",
                "description": "Set the public welcome message",
                "type": 1,
                "options": [
                    {"name": "message", "description": "Supports {username}, {server}, {memberCount}", "type": 3, "required": True},
                ],
            },
            {
                "name": "set-dm",
                "description": "Set the DM welcome message",
                "type": 1,
                "options": [
                    {"name": "message", "description": "Supports {username}, {server}, {memberCount}", "type": 3, "required": True},
                ],
            },
            {"name": "preview", "description": "Preview the current welcome message template", "type": 1},
        ],
    },
    {
        "name": "leave-message",
        "description": "Configure leave message templates",
        "options": [
            {
                "name": "set",
                "description": "Set the leave message",
                "type": 1,
                "options": [
                    {"name": "message", "description": "Supports {username}, {server}, {memberCount}", "type": 3, "required": True},
                ],
            },
            {"name": "preview", "description": "Preview the current leave message template", "type": 1},
        ],
    },
    {
        "name": "preview",
        "description": "Generate a live card preview",
        "options": [
            {"name": "welcome", "description": "Preview the welcome card", "type": 1},
            {"name": "leave",   "description": "Preview the leave card",   "type": 1},
        ],
    },
    {
        "name": "reset",
        "description": "Reset all server configuration to defaults",
        "options": [
            {"name": "confirm", "description": "Confirm — this action cannot be undone", "type": 1},
        ],
    },
]


def sync():
    url = f"https://discord.com/api/v10/applications/{APPLICATION_ID}/guilds/{GUILD_ID}/commands"
    print(f"Syncing {len(commands)} command(s) to guild {GUILD_ID}...")

    res = requests.put(url, headers=headers, json=commands)

    if res.status_code in (200, 201):
        registered = res.json()
        print(f"Done. {len(registered)} command(s) registered:")
        for cmd in registered:
            print(f"  /{cmd['name']}")
    else:
        print(f"Failed ({res.status_code}): {res.text}")
        sys.exit(1)


if __name__ == "__main__":
    sync()