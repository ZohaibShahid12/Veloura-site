# Database Overview

The SQLite database is created automatically at `data/veloura.sqlite`.

Core entities include:

- branches
- users, sessions
- service_categories, services
- staff, staff_services, staff_leave, staff_attendance
- customers, customer_addresses
- appointments, appointment_services, appointment_notes
- packages, memberships
- products, cart_items, orders, order_items
- payments, gift_cards
- reviews, consultations, bridal_bookings
- inventory_movements
- notifications, wishlists
- expenses, audit_logs, settings

Foreign keys, unique customer contact indexes, schedule indexes and transaction-safe stock/booking updates are included.
