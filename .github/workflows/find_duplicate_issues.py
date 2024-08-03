#!/usr/bin/env python3
import os
import openai
import json
from github import Github

# Initialize GitHub and OpenAI clients
if not os.getenv("GITHUB_TOKEN"):
    print("Please set the GITHUB_TOKEN environment variable.")
    exit(1)
g = Github(os.getenv("GITHUB_TOKEN"))

if not os.getenv("OPENAI_API_KEY"):
    print("Please set the OPENAI_API_KEY environment variable.")
    exit(1)
openai.api_key = os.getenv("OPENAI_API_KEY")

# Target repository
repo_name = os.getenv("GITHUB_REPOSITORY")
if not repo_name:
    print("Please set the GITHUB_REPOSITORY environment variable.")
    exit(1)

repo = g.get_repo(repo_name)

# Fetch all issues and comments
issues = repo.get_issues(state="open")
all_issues = {}
for issue in issues:
    comments = issue.get_comments()
    all_comments = [comment.body for comment in comments]
    all_issues[issue.number] = {
        "title": issue.title,
        "body": issue.body,
        "comments": all_comments,
    }

# Create the start of the prompt template with all the issues and bodies.
system_issues_prompt = ""
for issue_number, issue_data in all_issues.items():
    system_issues_prompt += f"""
#{issue_number}: {issue_data['title']}

# body

{issue_data['body']}

---

"""

print(system_issues_prompt)

# Get the token count for the system_issues_prompt
print(f"Token count for system_issues_prompt: {len(system_issues_prompt.split())}")


# Analyze issues for duplicates using OpenAI's GPT-4
potential_duplicates = []
for issue_number, issue_data in all_issues.items():
    print(f"Analyzing issue #{issue_number} {issue_data['title']} ...")
    response = openai.chat.completions.create(
        model="gpt-4o",
        response_format={ "type": "json_object" },
        messages=[
            {
                "role": "system",
                "content": """You are a distinguished engineer. Your peers
keep creating duplicate GitHub issues and you have OCD. You have decided to use your
skills to find duplicates for them. You are analyzing the issues in the repository.
Your goal is to find potential duplicate GitHub issues.
Do not return the current issue as a duplicate of itself. Use the issue title, body,
and comments to find potential duplicates.

Whenever you find a potential duplicate, you need to be very very sure that it is a duplicate.
Error on the side of caution. If you are not sure, do not return it as a duplicate.
Most won't have duplicates and that is fine! You are looking for the ones that do.
If you mistakenly return a non-duplicate, you will be penalized to spend time with the
interns helping them learn to exit vim. You do not want to do that.

Check and make sure that no one else has already commented that the issue is a duplicate.
If they have commented, you should not return it as a duplicate.

Your confidence level must be over 90% to return an issue as a duplicate.

Take a deep breath and begin your analysis. Your reputation is on the line.
Your responses should be formatted as a json array.
The following are examples of valid responses:

```json
[]
```

```json
[{"issue_number": 1234, "title": "Issue title"}]
```

Below are the current open issues in the repository. They are formatted as:

#{issue number}: {issue title}

# body

{issue body}

---

The current open issues in the repository are:
"""
                + system_issues_prompt,
            },
            {
                "role": "user",
                "content": f"""Find duplicates for GitHub issue #{issue_number} titled:
{issue_data['title']}

# issue body
{issue_data['body']}

---

# issue comments:
{issue_data['comments']}""",
            },
        ],
    )

    if len(response.choices) == 0:
        print("No duplicate issues found.")
        continue

    for response in response.choices:
        print(response.message.content)

# Print potential duplicates
print("Potential duplicate issues:")
for issue_number in potential_duplicates:
    issue = all_issues[issue_number]
    print(
        f"Issue #{issue_number}: {issue['title']} - {repo.html_url}/issues/{issue_number}"
    )
