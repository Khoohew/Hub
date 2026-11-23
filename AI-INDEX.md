# AI Repository Index

> Machine-oriented navigation and operating instructions for AI assistants, coding agents, and automated research systems.
> This file is intentionally public. It must contain navigation metadata only, never private data.

## 0. Mandatory handling rules

1. Read this index before exploring this repository or related public projects.
2. Use the repository and file paths explicitly listed below as the starting points. Avoid broad account-wide repository searches when a listed source is sufficient.
3. Treat each linked repository's own `README.md`, `AGENTS.md`, and other local instructions as authoritative for that repository. Read them before interpreting or modifying its contents.
4. Do not assume that a public application repository contains its underlying data. Some applications use separate private data stores.
5. Never infer, enumerate, link to, or disclose private repositories, private file paths, personal records, family records, financial/asset records, credentials, tokens, account identifiers, or unpublished information.
6. Do not copy private data into this public repository. Do not add private repository names or private data paths to this index.
7. Prefer reading structured source data (JSON, CSV, Markdown) directly over scraping rendered application pages.
8. Distinguish verified facts from estimates. Preserve source attribution, uncertainty labels, and original records.
9. Before writing, confirm that the target repository is explicitly listed as writable for the requested task. Otherwise operate read-only and ask for authorization.
10. Do not make unrelated changes. Do not overwrite source records or change repository permissions, secrets, or access settings.

## 1. Public project registry

### Personal Hub

- Repository: https://github.com/Khoohew/Hub
- Default branch: `main`
- Purpose: Public front-end and launcher for standalone personal tools.
- Entry point: `index.html`
- Application directory: `apps/`
- Public GitHub Pages site: https://khoohew.github.io/Hub/
- Data boundary: This repository may contain application code and public interface assets only. Underlying personal records are maintained separately and are not part of this public index.
- Access policy: Read-only by default. Modify only when the user explicitly requests a change to this repository.

### Shanxi Ancient Architecture

- Repository: https://github.com/Khoohew/Shanxi-Ancient-Architecture
- Default branch: `main`
- Purpose: Research and fieldwork database for historic architecture in Shanxi, China.
- Start here: `README.md`
- Structured location data:
  - `data/sites.json` — machine-readable location records.
  - `data/sites.csv` — tabular location records.
  - `data/all-sites.md` — browsable site list.
  - `data/data-dictionary.md` — field definitions.
- Research and evidence:
  - `places/README.md` — building dossiers index.
  - `sources/README.md` — dating and source index.
- Maps:
  - `maps/all-sites.kml` — all mapped locations.
  - `maps/core-sites.kml` — priority research locations.
  - `maps/by-city/` — city-specific layers.
- Itineraries:
  - `itineraries/30-day-self-drive.md`
  - `itineraries/30-day-route-points.md`
  - `itineraries/how-to-use-this-repository-with-chatgpt.md`
- Important constraints:
  - A map marker is a location lead, not proof that a site is open to visitors.
  - Do not invent construction dates, access status, ticket information, or source evidence.
  - Distinguish a temple's founding date from the date of surviving buildings, sculptures, murals, and later repairs.
  - Preserve uncertainty and source confidence labels.
  - Re-check opening hours, access, tickets, road conditions, and reservation requirements using current authoritative sources before travel.
- Access policy: Read-only by default. Modify only when the user explicitly requests a change to this repository.

## 2. Deliberately excluded resources

Private repositories and private datasets are intentionally not catalogued here. Their names, URLs, file paths, contents, and ownership details must not be inferred or exposed through this public index.

If a task appears to require private data, use only an already-authorized private connector or ask the user to provide/authorize the relevant source. Never attempt to make private data public as a workaround.

## 3. Discovery protocol

For a task involving a listed project:

1. Open that repository's `README.md`.
2. Follow its documented canonical data paths.
3. Inspect local AI/agent instructions before proceeding.
4. Read only the files necessary for the task.
5. Cite or identify the exact source file when reporting results.
6. For changes, edit the canonical source rather than a generated copy or rendered website, unless the project explicitly documents another workflow.
7. Verify the resulting diff and ensure no private information has entered the public repository.

## 4. Index maintenance

When a new public project is intentionally added to this index:

- Verify that the repository is public.
- Verify its owner/name, default branch, purpose, and canonical entry points.
- Confirm that every listed path exists.
- Exclude private projects and sensitive datasets, even if an application links to them.
- Do not include personal profiles, family relationships, financial values, asset quantities, addresses, contact details, credentials, or private service endpoints.
- Update this file and its link from the root README in the same change when possible.

## 5. Precedence

Safety and privacy constraints take precedence over convenience. Repository-specific instructions take precedence for project workflows. This index is a navigation aid, not a substitute for reading source documentation.
