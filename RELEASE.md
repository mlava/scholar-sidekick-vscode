# Releasing `scholar-sidekick-vscode`

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry. Commit.
2. `npm run lint && npm run compile && npm test`.
3. Push, then cut a GitHub Release whose tag is `v<package.json version>`:

   ```bash
   gh release create vX.Y.Z --target main --title "vX.Y.Z — <summary>" --notes "<what changed>"
   ```

   Publishing the Release fires `.github/workflows/release.yml`, which rebuilds,
   re-runs the tests, packages the `.vsix`, publishes it to **both registries via
   trusted publishing** — Open VSX (`ovsx publish --trusted-publishing`) and the
   VS Code Marketplace (`vsce publish --oidc`) — with no token secret anywhere,
   and attaches the `.vsix` to the Release. A tag that does not match
   `package.json` fails the run. Neither publisher falls back to a PAT.

4. **Re-running one target.** If a registry step failed (or its policy was not yet
   in place), run the workflow by hand from the Actions tab and untick the
   registry that already has this version — a duplicate version is refused and
   would fail the job.

## One-time trusted-publishing setup (done once per registry; redo only if deleted)

**VS Code Marketplace:** marketplace.visualstudio.com → Manage publishers →
`scholar-sidekick` → this extension → Trusted publishing → add a policy for the
GitHub repository `mlava/scholar-sidekick-vscode` and workflow `release.yml`.
Requires `@vscode/vsce` ≥ 4 (a devDependency here) and Node ≥ 22 in the job.

**Open VSX:**

open-vsx.org → Settings → Trusted Publishers → namespace `scholar-sidekick` →
GitHub Actions → owner `mlava`, repository `scholar-sidekick-vscode`, workflow
`release.yml`, environment empty. Registrations are immutable; delete and
recreate to change. The extension must have at least one active version
(the first release was published with a token).
