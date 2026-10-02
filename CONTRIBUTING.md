# Contributing

Thanks for helping improve Study Calendar. This project is designed for learning, so clear explanations and small pull requests are welcome.

## Development Flow

1. Fork or clone the repository.
2. Create a feature branch from `main`.
3. Run `pnpm install`.
4. Make a focused change.
5. Run `pnpm lint`, `pnpm test`, and `pnpm build`.
6. Open a pull request with a short explanation and screenshots for UI changes.

## Commit Style

Use concise, descriptive commit messages:

```text
Add reminder editor validation
Fix month grid event filtering
Document release workflow
```

## Pull Request Checklist

- The change is focused and easy to review.
- Tests or docs were updated when useful.
- `pnpm lint`, `pnpm test`, and `pnpm build` pass locally.
- UI changes include screenshots or a short visual description.

## Code Style

- Prefer simple functions over clever abstractions.
- Keep API behavior documented in `docs/API.md`.
- Keep user data fields documented in `docs/DATA_SCHEMA.md`.
