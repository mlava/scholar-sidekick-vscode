# Releasing `scholar-sidekick-vscode`

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry. Commit.
2. `npm run lint && npm run compile && npm test`.
3. Push, then cut a GitHub Release whose tag is `v<package.json version>`:

   ```bash
   gh release create vX.Y.Z --target main --title "vX.Y.Z — <summary>" --notes "<what changed>"
   ```

   Publishing the Release fires `.github/workflows/release.yml`, which rebuilds,
   re-runs the tests, packages the `.vsix`, publishes it to **Open VSX via
   trusted publishing** (OIDC — no token secret anywhere), and attaches the
   `.vsix` to the Release. A tag that does not match `package.json` fails the run.

4. **VS Code Marketplace is still manual** (no trusted publishing there). Download
   the `.vsix` from the Release (or `npm run package` locally) and either
   `npx vsce publish --packagePath scholar-sidekick-vscode-X.Y.Z.vsix` with a valid
   Azure DevOps PAT (`vsce login scholar-sidekick`), or upload it on the
   publisher page.

## One-time Open VSX setup (already done once; redo only if the registration is deleted)

open-vsx.org → Settings → Trusted Publishers → namespace `scholar-sidekick` →
GitHub Actions → owner `mlava`, repository `scholar-sidekick-vscode`, workflow
`release.yml`, environment empty. Registrations are immutable; delete and
recreate to change. The extension must have at least one active version
(the first release was published with a token).
