# Install & Prime

## Read
.env.sample (never read .env)
./app/server/.env.sample (never read .env)

## Read and Execute
.claude/commands/prime.md

## Run
- Remove the existing git remote: `git remote remove origin`
- Initialize a new git repository: `git init`
- Run `cp .env.sample .env`
- Install FE and BE dependencies
- Run `./scripts/copy_dot_env.sh` to copy the .env file from the tac-2 directory. Note, the tac-2 codebase may not exists, proceed either way.

## Report
- Output the work you've just done in a concise bullet point list.
- Instruct the user to fill out the root level ./.env based on .env.sample. 
- If `./app/server/.env` does not exist, instruct the user to fill out `./app/server/.env` based on `./app/server/.env.sample`
- Mention: 'To setup your AFK Agent, be sure to update the remote repo url and push to a new repo so you have access to git issues and git prs:
  ```
  git remote add origin <your-new-repo-url>
  git push -u origin main
  ```'