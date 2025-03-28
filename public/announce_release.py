import re
import os
import requests
import textwrap

webhook_url = os.getenv('DISCORD_WEBHOOK_URL')
release_version = os.getenv('RELEASE_VERSION')
release_body = os.getenv('RELEASE_BODY')

# Regular expression to match URLs
url_pattern = r'(http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+)'

# Function to encase URLs in <>
def encase_urls_with_angle_brackets(match):
    url = match.group(0)
    return f'<{url}>'

# Replace all URLs in the release_body with their <> enclosed version
modified_release_body = re.sub(url_pattern, encase_urls_with_angle_brackets, release_body)

# Ensure the modified_release_body does not exceed Discord's character limit
max_length = 500  # Adjust as needed
if len(modified_release_body) > max_length:
    modified_release_body = modified_release_body[:max_length].rsplit(' ', 1)[0]  # Avoid cutting off in the middle of a word
    modified_release_body += "... for full changelog, check out the link above."

# Message to send to Discord
data = {
    "content": textwrap.dedent(f'''
        **{release_version}** is now available! Check out the latest features and improvements here: <https://zoo.dev/modeling-app/download>

        {modified_release_body}
    '''),
    "username": "Design Studio Release Updates",
    "avatar_url": "https://raw.githubusercontent.com/KittyCAD/modeling-app/main/public/discord-avatar.png"
}

# POST request to the Discord webhook
response = requests.post(webhook_url, json=data)

# Check for success
if response.status_code == 204:
    print("Successfully sent the message to Discord.")
else:
    print(f"Failed to send the message to Discord. Status code: {response.status_code}, Response: {response.text}")

print(modified_release_body)
print(data["content"])
