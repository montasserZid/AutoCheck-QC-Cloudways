# Database foundation

## Current application data map

The Phase 1 browser namespace is `autocheck-qc:v2:`. Source inspection found
these records:

| Key | Shape | Database destination |
| --- | --- | --- |
| `intake-draft` | `VehicleIntake`, current step, input method, found/uncertain field arrays | Remains local draft state |
| `intake` | Listing URL/text, normalized vehicle fields, seller claims, photo metadata, language, submission timestamp | `listings` + `vehicles` |
| `report-type` | `free` or `full` | `reports.report_package` when a report is created |
| `report` | Generated ID/timestamp plus structured summary, findings, risk data, recommendations, questions, and disclaimer | `reports.structured_payload` with relational status/version metadata |
| `booking-draft` | Customer, vehicle, seller/location, scheduling fields, urgency, notes, and source vehicle key | Remains local draft state |
| `inspection` | Generated ID/timestamp, customer contact, vehicle snapshot, scheduling data, notes, optional report ID | `inspection_requests` linked to listing, vehicle, and optional report |
| `contact` | Topic, name, email, message, and creation timestamp | `contact_messages` |

The application currently creates report references as `AC-<timestamp>` and
inspection references as `QC-<random UUID prefix>`. UUIDs are canonical database
keys; those current identifiers can be retained in nullable `external_reference`
columns during the later persistence migration.

`photos` contains metadata only (`name`, `size`, `type`); the application does
not currently upload binary files. Extraction `found`/`uncertain` arrays describe
the transient review experience and may be captured in
`listings.normalization_metadata` when server normalization is introduced.

## Boundary and security model

Customer workflows still use `src/lib/localStorage.ts`. No behavior is migrated
in this phase. Future persistence code should implement the contracts in
`src/lib/data/operationalRepository.ts` inside `src/server/`, using the
server-only Supabase client. React components and browser bundles must never use
the secret client.

All operational tables have forced RLS, restrictive deny policies for `anon` and
`authenticated`, and revoked public API grants. With no authentication system,
all sensitive reads and writes must be mediated by validated Next.js server
routes/actions using `SUPABASE_SECRET_KEY`. The future vehicle-knowledge corpus
is a separate domain and is not represented or imported here.
