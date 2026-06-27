# Spec-Kit AI Agent Rules

You must operate strictly under the Spec-Driven Development (SDD) paradigm:
1. NEVER write code without verifying its corresponding specification in `.spec-kit/specs/`.
2. Before implementing a task from `.spec-kit/tasks/`, change its status to `IN_PROGRESS` in the markdown file.
3. After implementation, run `pnpm spec:check` to verify structural and compliance integrity.
4. When a task meets all Acceptance Criteria, update its status to `DONE` and provide the git commit hash.
