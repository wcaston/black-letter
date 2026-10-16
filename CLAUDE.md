# Know Your Shit: notes for Claude

- This repository is the published site only. The guide's content is `content.enc.json`, encrypted with AES-GCM using a key derived from the clinic passphrase (PBKDF2-SHA256). The readable source (`source.md`), the private settings (`config.json`) and the passphrase are kept privately by the owner (his claude.ai Project files and a local copy). **Never commit any of them here.**
- Rebuild after content changes: `node tools/build.mjs --source <source.md> --config <config.json> --passphrase-file <passphrase.txt> --out .` It writes `content.enc.json`, bumps `VERSION` in `sw.js`, and refuses to finish if readable guide text or the passphrase appears anywhere in the site folder.
- GitHub Pages publishes the **gh-pages** branch. Keep `main` and `gh-pages` identical: commit on `main`, then `git push origin main main:gh-pages`.
- `source.md` format is explained in the comment at its top: headings are menus and pages, `1.` lines are numbered steps, `(a)` lines are statute items, `Source:` lines are source notes, `{teaser}` marks a box that can't be tapped.
- Feedback and Contribute buttons post to the owner's Google Form; the form's address and field IDs live inside the encrypted content (from `config.json`).
- Content rules from the owner: only what clinic students supply, plus statute text he asks for; never client information; flag anything that looks wrong instead of fixing it; typo fixes extremely conservative.
