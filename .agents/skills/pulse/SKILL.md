```markdown
# pulse Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `pulse` TypeScript codebase. You'll learn about file naming, import/export styles, commit message habits, and how to write and run tests. This guide is ideal for new contributors or anyone seeking to align with the project's established practices.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `dataFetcher.ts`

### Imports
- Use **relative import paths**.
  - Example:
    ```typescript
    import { fetchData } from './dataFetcher';
    ```

### Exports
- Use **named exports** rather than default exports.
  - Example:
    ```typescript
    // dataFetcher.ts
    export function fetchData() { /* ... */ }
    ```

### Commit Messages
- **Freeform** style, no enforced prefixes.
- Average commit message length: ~63 characters.
  - Example:  
    ```
    Add support for user profile updates
    ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new functionality  
**Command:** `/add-feature`

1. Create a new file using camelCase naming.
2. Implement the feature using TypeScript.
3. Use relative imports for dependencies.
4. Export your functions or components as named exports.
5. Write corresponding tests in a `.test.ts` file.
6. Commit your changes with a clear, descriptive message.

### Fixing a Bug
**Trigger:** When resolving a reported issue  
**Command:** `/fix-bug`

1. Locate the relevant file(s) using camelCase naming.
2. Apply the necessary code changes.
3. Update or add tests in the corresponding `.test.ts` file.
4. Commit with a concise message describing the fix.

### Writing Tests
**Trigger:** When adding or updating tests  
**Command:** `/write-test`

1. Create or update a test file with the pattern `*.test.ts`.
2. Write test cases for your functions or components.
3. Use the project's preferred (unknown) testing framework.
4. Run tests to ensure correctness.

## Testing Patterns

- **Test File Pattern:** Files should be named with the `.test.ts` suffix.
  - Example: `userProfile.test.ts`
- **Framework:** Not explicitly detected; follow existing patterns in the repo.
- Place tests alongside the code or in a dedicated test directory, as per project structure.

## Commands
| Command      | Purpose                                   |
|--------------|-------------------------------------------|
| /add-feature | Start the workflow for adding a new feature|
| /fix-bug     | Begin the bugfix workflow                 |
| /write-test  | Guide for writing or updating tests        |
```
