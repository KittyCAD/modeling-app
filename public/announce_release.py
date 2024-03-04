import requests
import os

webhook_url = os.getenv('DISCORD_WEBHOOK_URL')
release_version = os.getenv('RELEASE_VERSION')
release_body = os.getenv('RELEASE_BODY')

# Truncate the release_body to fit within Discord's character limit
max_length = 500  # Set a max length less than 2000 to leave room for additional text
if len(release_body) > max_length:
    release_body = release_body[:max_length].rsplit(' ', 1)[0]  # Avoid cutting off in the middle of a word
    release_body += "... for full changelog, check out the link above."

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

# Send the message to Discord
try:
    response = requests.post(webhook_url, json=data)
    if response.status_code != 204:
        print(f"Failed to send the message to Discord. Status code: {response.status_code}, Response: {response.text}")
    else:
        print("Successfully sent the message to Discord.")
except requests.exceptions.RequestException as e:
    print(f"Request failed: {e}")