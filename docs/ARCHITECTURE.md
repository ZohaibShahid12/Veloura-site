# Application Architecture

## Request Flow

1. Express receives the request.
2. The database-backed session middleware loads the user and role.
3. A CSRF token is required for all POST forms.
4. Role middleware protects customer, staff and management routes.
5. Business rules execute against SQLite.
6. EJS renders responsive server-side pages.

## Booking Rules

The booking engine calculates the total duration from selected services and checks:

- active branch and hours
- expert service qualification
- working day and shift
- approved leave
- overlapping appointments
- appointment date not in the past

The checks run once for availability display and again inside a write transaction before confirmation.

## Role Model

- customer
- staff
- receptionist
- manager
- admin

Managers are branch-scoped. Admin has central access. Receptionists can manage operational bookings and customer records but cannot change protected plan/configuration data.
