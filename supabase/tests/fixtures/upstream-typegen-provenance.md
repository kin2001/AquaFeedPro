# Public upstream typegen format fixture

`upstream-typegen-0.4.0-public-snippet.txt` is the `Database` portion of the first publicly generated inline snapshot in official Supabase SDK's `packages/postgrest-typegen/test/generation/typescript.test.ts`, test `table Row/Insert/Update with enum, identity ALWAYS, default and nullable`.

- Package: `@supabase/postgrest-typegen` **0.4.0**, official repository `https://github.com/supabase/sdk`, npm metadata gitHead **d0bebf2b2d7af05a7280cca2f84b6ae22b268b5e**; version/repository verified against that commit's package.json.
- Source: https://github.com/supabase/sdk/blob/d0bebf2b2d7af05a7280cca2f84b6ae22b268b5e/packages/postgrest-typegen/test/generation/typescript.test.ts
- Full source SHA256: `20f1aa6edcd631f38e9049eb5149d798aab34bfcbebfcadb1cf567a93102b83c`.
- Fixture SHA256: `c24cfc4b11dc070c1c9b2d980124e00c7f7f92cce80f5d18b420fda73215f771`.
- Extraction: copy the first `export type Database = {` block up to (excluding) `type DatabaseWithoutInternals`; remove only the snapshot's common six-space source indentation and retain a final LF. No schema/table/field/type names or values were invented or renamed. This is a public example, **not AquaFeed schema types** and not a complete compilable generated module (`Json` and helper declarations are intentionally outside the snippet).

The fixture is the upstream formatter's public snapshot. Tests mechanically quote its existing property keys and vary whitespace to reproduce the native CLI's unformatted key shape, without inventing table definitions. The real AquaFeed `database.types.ts` must still come from actual isolated generation; this fixture is never used as that artifact.

Why the quoted/unformatted form is source-backed:

- Official CLI v2.120.0 commit `753520fa7202ed5f8b25883a4c0aa7e5e9ad1fc4`, `apps/cli/src/commands/gen/types/types.typegen-host.ts:110-129`, supplies identity formatting.
- `@supabase/typegen` 0.2.2, official SDK npm gitHead `6ef13f09f173df5b7448e012035dbf9bd889b0b6`, pins `@supabase/postgrest-typegen=0.4.0`; its `src/languages/index.ts:55-70` passes that host formatter through.
- The pinned 0.4.0 generator's `src/generation/typescript.ts:792,802,984` emits schema/table/function names via `JSON.stringify`. Identity formatting preserves those quotes and raw indentation/comma joins. The old guard's unquoted substring/two-space assumptions were therefore invalid.
