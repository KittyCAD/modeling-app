import requests
import os

webhook_url = os.getenv('DISCORD_WEBHOOK_URL')
release_version = os.getenv('RELEASE_VERSION')
release_body = os.getenv('RELEASE_BODY')

# message to send to Discord
data = {
    "content": 
        f'''
        **{release_version}** is now available! Check out the latest features and improvements here: https://zoo.dev/modeling-app/download
        {release_body}
        ''',
    "username": "Modeling App Release Updates",
    "avatar_url": "https://raw.githubusercontent.com/KittyCAD/modeling-app/main/public/discord-avatar.png"
}

# POST request to the Discord webhook
response = requests.post(webhook_url, json=data)

# Check for success
if response.status_code == 204:
    print("Successfully sent the message to Discord.")
else:
    print("Failed to send the message to Discord.")