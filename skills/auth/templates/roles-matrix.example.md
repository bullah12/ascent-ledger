# Roles & Permissions Matrix (template)

Fill this out in each project's PROJECT_SPEC.md **before** building any
protected endpoint. One row per permission, one column per role.

Legend: ✅ allowed · 🔸 allowed with ownership check · ❌ denied

| Permission            | admin | staff | wholesale | user |
|-----------------------|:-----:|:-----:|:---------:|:----:|
| catalog:read          | ✅    | ✅    | ✅        | ✅   |
| pricing:wholesale     | ✅    | ✅    | ✅        | ❌   |
| orders:create         | ✅    | ✅    | ✅        | ✅   |
| orders:read           | ✅    | ✅    | 🔸 own    | 🔸 own |
| orders:write          | ✅    | ✅    | ❌        | ❌   |
| products:write        | ✅    | ✅    | ❌        | ❌   |
| accounts:approve      | ✅    | ❌    | ❌        | ❌   |
| settings:write        | ✅    | ❌    | ❌        | ❌   |

Rules of thumb:

- If two roles have identical rows, merge them.
- If a cell needs a footnote longer than "own resources only", it is probably
  two different permissions — split it.
- The `admin` column should be all ✅; if not, you likely need a `superadmin`.
