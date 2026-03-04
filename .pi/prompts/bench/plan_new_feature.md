---
description: Creates a concise engineering implementation plan based on user requirements and saves it to specs directory
argument-hint: [run-name]
---

# Purpose

Create a detailed implementation plan based on the user's requirements provided through the `USER_PROMPT` variable. Analyze the request, think through the implementation approach, and save a comprehensive specification document to `PLAN_OUTPUT_DIRECTORY/<name-of-plan>.md` that can be used as a blueprint for actual development work.

## Variables

RUN_NAME: $1
USER_PROMPT: "Add 3 new ui themes, add a 10 minute live activity pulse time span, and add a regex enabled frontend only search bar for the agent event stream that's full width placed right below our agent/app tags."
PLAN_OUTPUT_DIRECTORY: `specs/`

## Instructions

- Carefully analyze the user's requirements provided in the USER_PROMPT variable
- Think deeply (ultrathink) about the best approach to implement the requested functionality or solve the problem
- Create a concise implementation plan that includes:
  - Clear problem statement and objectives
  - Technical approach and architecture decisions
  - Step-by-step implementation guide
  - Potential challenges and solutions
  - Testing strategy
  - Success criteria
- Generate the filename as `plan_new_feature_<RUN_NAME>.md`
- Save the complete implementation plan to `PLAN_OUTPUT_DIRECTORY/plan_new_feature_<RUN_NAME>.md`
- Ensure the plan is detailed enough that another developer could follow it to implement the solution
- Include code examples or pseudo-code where appropriate to clarify complex concepts
- Consider edge cases, error handling, and scalability concerns
- Structure the document with clear sections and proper markdown formatting
- IMPORTANT: Do not use any subagents to do this. Run your own code to accomplish this task.
- IMPORTANT: Remember you are planning, not building. You are not writing any code. 

## Workflow

1. Analyze Requirements - THINK HARD and parse the USER_PROMPT to understand the core problem and desired outcome
2. Design Solution - Develop technical approach including architecture decisions and implementation strategy
3. Document Plan - Structure a comprehensive markdown document with problem statement, implementation steps, and testing approach
4. Generate Filename - Use the format `plan_new_feature_<RUN_NAME>.md`
5. Save & Report - Write the plan to `PLAN_OUTPUT_DIRECTORY/plan_new_feature_<RUN_NAME>.md` and provide a summary of key components

## Report

After creating and saving the implementation plan, provide a concise report with the following format:

```
✅ Implementation Plan Created

File: PLAN_OUTPUT_DIRECTORY/<filename>.md
Topic: <brief description of what the plan covers>
Key Components:
- <main component 1>
- <main component 2>
- <main component 3>
```