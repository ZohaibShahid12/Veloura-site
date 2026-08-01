# Veloura Luxury Salon — Full-Stack Website & Management System

A runnable full-stack salon web application with a premium public website, live appointment booking, customer portal, staff workspace and multi-role admin dashboard.

## Technology

- Node.js 22+
- Express 5
- EJS server-rendered frontend
- Built-in Node SQLite database (`node:sqlite`)
- Bootstrap 5.3.6, custom responsive media queries and vanilla JavaScript
- No frontend build step

## Quick Start on Windows

1. Install **Node.js 22 or newer**.
2. Extract the ZIP.
3. Double-click `start.bat`.
4. Open `http://localhost:3000`.

Or use a terminal:

```bash
npm install
npm start
```

The database and realistic demonstration records are created automatically on first run.

## Demo Accounts

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@veloura.test` | `Admin@123` |
| Branch Manager | `manager@veloura.test` | `Manager@123` |
| Receptionist | `reception@veloura.test` | `Reception@123` |
| Staff Expert | `staff@veloura.test` | `Staff@123` |
| Massage Therapist | `wellness@veloura.test` | `Wellness@123` |
| Customer | `customer@veloura.test` | `Customer@123` |

## Included Functional Modules

### Public Website
- Luxury responsive homepage
- Service categories, search and filters
- Service detail pages
- Experts directory
- Packages and memberships
- Bridal consultation workflow
- Gallery and verified reviews
- Product shop, cart and checkout
- Digital gift cards
- Multi-step appointment booking
- Live slot calculation and double-booking prevention

### Customer Portal
- Dashboard and Customer ID
- Appointment history
- Cancellation and rescheduling
- Product order history
- Membership and loyalty points
- Profile, allergies, sensitivities and preferences
- Multiple addresses
- Digital consultations
- Notifications

### Staff Portal
- Assigned appointments
- Check-in / service / pause / completion status
- Treatment notes, formulas and used products
- Attendance check-in/out
- Leave requests
- Commission overview

### Management Portal
- Operational dashboard
- Customer CRM and walk-in profiles
- Duplicate customer merge
- Appointment management
- Staff and leave approval
- Services and pricing
- Bridal journey tracking
- Product catalogue
- Inventory adjustments and movement ledger
- Payments ledger
- Membership plans
- Multi-branch management
- Reports and analytics
- System settings and audit trail

## Connected Business Logic

- A booking updates customer, staff, management, payment and notification records.
- Booking slots validate branch hours, staff schedules, leave, service qualification and overlaps.
- Booking creation is revalidated inside a SQLite `BEGIN IMMEDIATE` transaction.
- Cancelling a booking releases its slot and updates the customer balance.
- Completed appointments update customer spend, pending balance, last visit and loyalty points.
- Product checkout reduces stock and records inventory movements, orders, payments and points.
- Low-stock products are highlighted automatically.
- Approved leave removes a staff member from booking availability.
- Membership discounts are applied during booking.

## Security Included

- Passwords hashed with Node `scrypt` and per-password salts
- Database-backed sessions
- HTTP-only, SameSite cookies
- CSRF protection on POST actions
- Login attempt throttling
- Role-based route protection
- Branch scoping for managers
- Server-side validation
- Audit log
- SQLite foreign keys and unique constraints
- No complete card data stored

## Payments and Notifications

Payment and WhatsApp/SMS/email channels run in a safe demonstration mode. The records and workflows work, but live third-party delivery requires provider credentials and integration configuration before production use.

## Reset Demo Data

Stop the application and delete:

```text
data/veloura.sqlite
```

Start the application again. A fresh database will be created and seeded.

## Production Checklist

Before deploying publicly:

- Put the app behind HTTPS and a reverse proxy.
- Replace sandbox payment actions with verified provider webhooks.
- Add official WhatsApp/SMS/email credentials.
- Move environment secrets to a secure secret manager.
- Add automated encrypted backups.
- Review local privacy, tax, refund and consent requirements.
- Use object storage for customer image uploads.
- Add production monitoring and automated tests.

## Project Structure

```text
server.js                 Main routes, authentication and business logic
db.js                     Schema, migrations, seed data and password helpers
views/                    Public, customer, staff and admin EJS screens
public/css/style.css      Complete responsive luxury design system
public/js/app.js          Booking wizard, transitions, menus and modals
data/                     Runtime SQLite database
docs/                     Architecture and database notes
```

## Windows dependency repair

If you see `MODULE_NOT_FOUND` (for example, `Cannot find module 'body-parser'`), run `REPAIR_WINDOWS.bat`. It removes the incomplete dependency folder and installs a clean set of packages before starting the server.

## Version 1.1 — Massage & Service Films

- Dedicated Massage & Wellness category with six bookable services
- Massage services connected to live availability, staff schedules, booking, admin service management and reports
- Two local high-quality motion films for Massage & Wellness and the Bridal Atelier
- Interactive film selector on the Services page
- Contextual film preview on Massage and Bridal service detail pages
- Responsive video layouts with autoplay, loop, controls and reduced-motion-safe website transitions

## Massage Film Update

- Real massage treatment film showing professional back/body massage
- Two visible spa treatment scenes with smooth cinematic motion and crossfade
- Local MP4 and poster image, responsive across desktop and mobile
- Media credits are listed in `MEDIA_CREDITS.md`


## Media notes

- Updated massage service film now clearly shows a therapist performing a real back massage on a client in a spa setting.


## V6 gallery and shop update
- Center-aligned desktop navigation and hero copy.
- Dense responsive gallery mosaic with twelve service visuals and no empty desktop column.
- Expanded service discovery cards for hair, bridal, skin, nails, massage and packages.
- Expanded shop category discovery, product catalogue, expert aftercare section and service promises.

## V7 equal-card layout update
- Gallery images now use one consistent size and ratio with no oversized featured tiles.
- Gallery service features use equal-height compact cards.
- Shop categories and product cards use aligned, equal-size responsive grids.
- Added Beauty Tools, Body Care, Home Services and Membership discovery items.


## V8 stale-server fix

Use `START_V8_FRESH.bat`. It stops only the process currently listening on port 3000, then launches this extracted V8 folder. Open `/version` to verify that `v8.0.0` is running. Static CSS and JavaScript use unique V8 filenames and no-cache headers.


## V9 Responsive Bootstrap Update

- Bootstrap 5.3.6 is included locally for dependable offline styling and components.
- Dedicated final media-query layer covers desktop, laptop, tablet, mobile and 320px devices.
- Responsive public pages, booking flow, customer portal, staff workspace and admin dashboard.
- Mobile navigation, tables, forms, grids, images, videos, modals and touch targets improved.
- Use `START-RESPONSIVE.bat` on Windows, or run `npm start`.


## Final responsive update

This edition includes Bootstrap 5.3 and final custom media queries that prevent page-level horizontal scrolling across desktop, laptop, tablet, mobile, and compact 320px screens. Mobile menus, booking progress, account navigation, charts, forms, media, cards, and portal layouts now remain contained within the viewport.

## Final responsive polish

The final build adds `public/css/responsive-polish.css`, a semantic Bootstrap navigation structure, improved tablet/mobile navigation, and non-congested product cards across all supported screen sizes.
