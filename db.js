const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// Vercel Functions can only write to the temporary directory.
// Locally, the original project data directory is used as before.
const isVercel = Boolean(process.env.VERCEL);
const bundledDbPath = path.join(__dirname, 'data', 'veloura.sqlite');
const dataDir = isVercel
  ? path.join(os.tmpdir(), 'veloura')
  : path.join(__dirname, 'data');

fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'veloura.sqlite');

// Start each Vercel function instance with the bundled demo database.
if (isVercel && !fs.existsSync(dbPath) && fs.existsSync(bundledDbPath)) {
  fs.copyFileSync(bundledDbPath, dbPath);
}

const db = new DatabaseSync(dbPath);
// WAL creates extra files and is not suitable for Vercel's temporary filesystem.
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;');

function now() { return new Date().toISOString(); }
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expectedHex] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function code(prefix) {
  return `${prefix}-${new Date().toISOString().slice(2,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL, phone TEXT,
      opening_time TEXT DEFAULT '09:00', closing_time TEXT DEFAULT '21:00', active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', branch_id INTEGER,
      active INTEGER DEFAULT 1, created_at TEXT NOT NULL,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER, csrf TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS service_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, icon TEXT DEFAULT '✦'
    );
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER NOT NULL, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL, price REAL NOT NULL, duration INTEGER NOT NULL,
      home_service INTEGER DEFAULT 0, rating REAL DEFAULT 4.8, image TEXT, active INTEGER DEFAULT 1,
      FOREIGN KEY(category_id) REFERENCES service_categories(id)
    );
    CREATE TABLE IF NOT EXISTS memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price_monthly REAL, price_yearly REAL,
      discount_percent REAL DEFAULT 0, points_multiplier REAL DEFAULT 1, benefits TEXT, active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, branch_id INTEGER NOT NULL,
      title TEXT NOT NULL, speciality TEXT, bio TEXT, rating REAL DEFAULT 4.8, commission_rate REAL DEFAULT 10,
      working_days TEXT DEFAULT '1,2,3,4,5,6', start_time TEXT DEFAULT '09:00', end_time TEXT DEFAULT '18:00',
      image TEXT, active INTEGER DEFAULT 1,
      FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(branch_id) REFERENCES branches(id)
    );
    CREATE TABLE IF NOT EXISTS staff_services (
      staff_id INTEGER NOT NULL, service_id INTEGER NOT NULL, PRIMARY KEY(staff_id, service_id),
      FOREIGN KEY(staff_id) REFERENCES staff(id) ON DELETE CASCADE,
      FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, customer_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, email TEXT, phone TEXT, whatsapp TEXT, dob TEXT, gender TEXT,
      skin_type TEXT, hair_type TEXT, allergies TEXT, sensitivities TEXT, category TEXT DEFAULT 'New',
      loyalty_points INTEGER DEFAULT 0, membership_id INTEGER, last_visit TEXT, total_spent REAL DEFAULT 0,
      pending_balance REAL DEFAULT 0, preferred_staff_id INTEGER, favourite_branch_id INTEGER,
      internal_notes TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(membership_id) REFERENCES memberships(id),
      FOREIGN KEY(preferred_staff_id) REFERENCES staff(id), FOREIGN KEY(favourite_branch_id) REFERENCES branches(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_email_unique ON customers(lower(email)) WHERE email IS NOT NULL AND email <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_phone_unique ON customers(phone) WHERE phone IS NOT NULL AND phone <> '';
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, label TEXT DEFAULT 'Home', address TEXT NOT NULL,
      city TEXT, is_default INTEGER DEFAULT 0, FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, booking_code TEXT UNIQUE NOT NULL, customer_id INTEGER NOT NULL,
      branch_id INTEGER NOT NULL, staff_id INTEGER, appointment_date TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL, visit_type TEXT DEFAULT 'salon', address TEXT,
      status TEXT DEFAULT 'confirmed', notes TEXT, total REAL DEFAULT 0, deposit REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'unpaid', room TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(branch_id) REFERENCES branches(id),
      FOREIGN KEY(staff_id) REFERENCES staff(id)
    );
    CREATE INDEX IF NOT EXISTS idx_appt_schedule ON appointments(appointment_date, staff_id, start_time, end_time);
    CREATE TABLE IF NOT EXISTS appointment_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT, appointment_id INTEGER NOT NULL, service_id INTEGER NOT NULL,
      price REAL NOT NULL, duration INTEGER NOT NULL,
      FOREIGN KEY(appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
      FOREIGN KEY(service_id) REFERENCES services(id)
    );
    CREATE TABLE IF NOT EXISTS appointment_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, appointment_id INTEGER NOT NULL, staff_id INTEGER,
      note TEXT, formula TEXT, used_products TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
      FOREIGN KEY(staff_id) REFERENCES staff(id)
    );
    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT,
      price REAL NOT NULL, original_price REAL, duration_days INTEGER DEFAULT 30, category TEXT, image TEXT, active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
      category TEXT, brand TEXT, description TEXT, price REAL NOT NULL, stock INTEGER DEFAULT 0,
      min_stock INTEGER DEFAULT 5, image TEXT, rating REAL DEFAULT 4.7, active INTEGER DEFAULT 1,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_token TEXT NOT NULL, user_id INTEGER, product_id INTEGER NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1, UNIQUE(session_token, product_id),
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT UNIQUE NOT NULL, customer_id INTEGER NOT NULL,
      total REAL NOT NULL, status TEXT DEFAULT 'processing', payment_method TEXT, payment_status TEXT DEFAULT 'paid',
      fulfillment TEXT DEFAULT 'delivery', address TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      qty INTEGER NOT NULL, price REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, payment_code TEXT UNIQUE NOT NULL, customer_id INTEGER,
      appointment_id INTEGER, order_id INTEGER, amount REAL NOT NULL, method TEXT NOT NULL,
      status TEXT DEFAULT 'paid', reference TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(appointment_id) REFERENCES appointments(id),
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );
    CREATE TABLE IF NOT EXISTS gift_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, purchaser_customer_id INTEGER,
      recipient_name TEXT, recipient_email TEXT, message TEXT, initial_amount REAL NOT NULL,
      balance REAL NOT NULL, expires_at TEXT, status TEXT DEFAULT 'active', created_at TEXT NOT NULL,
      FOREIGN KEY(purchaser_customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, service_id INTEGER, staff_id INTEGER,
      rating INTEGER NOT NULL, comment TEXT, verified INTEGER DEFAULT 0, approved INTEGER DEFAULT 1, created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(service_id) REFERENCES services(id),
      FOREIGN KEY(staff_id) REFERENCES staff(id)
    );
    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, staff_id INTEGER,
      skin_concerns TEXT, hair_concerns TEXT, goals TEXT, allergies TEXT, previous_treatments TEXT,
      recommendation TEXT, patch_test TEXT, consent INTEGER DEFAULT 0, follow_up_date TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id), FOREIGN KEY(staff_id) REFERENCES staff(id)
    );
    CREATE TABLE IF NOT EXISTS bridal_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, event_type TEXT NOT NULL, event_date TEXT NOT NULL,
      venue TEXT, package_name TEXT, coordinator TEXT, total REAL DEFAULT 0, deposit REAL DEFAULT 0,
      balance REAL DEFAULT 0, status TEXT DEFAULT 'consultation', notes TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, branch_id INTEGER,
      movement_type TEXT NOT NULL, quantity INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id), FOREIGN KEY(branch_id) REFERENCES branches(id)
    );
    CREATE TABLE IF NOT EXISTS staff_leave (
      id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      reason TEXT, status TEXT DEFAULT 'pending', created_at TEXT NOT NULL,
      FOREIGN KEY(staff_id) REFERENCES staff(id)
    );
    CREATE TABLE IF NOT EXISTS staff_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER NOT NULL, date TEXT NOT NULL,
      check_in TEXT, check_out TEXT, status TEXT DEFAULT 'present', UNIQUE(staff_id, date),
      FOREIGN KEY(staff_id) REFERENCES staff(id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, customer_id INTEGER, title TEXT NOT NULL,
      message TEXT NOT NULL, channel TEXT DEFAULT 'in-app', read_at TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE TABLE IF NOT EXISTS wishlists (
      customer_id INTEGER NOT NULL, product_id INTEGER NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(customer_id, product_id), FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, branch_id INTEGER, category TEXT, description TEXT,
      amount REAL NOT NULL, expense_date TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(branch_id) REFERENCES branches(id)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, entity TEXT,
      entity_id INTEGER, details TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT
    );
  `);
}

function seed() {
  const exists = db.prepare('SELECT COUNT(*) AS c FROM branches').get().c;
  if (exists) return;

  db.exec('BEGIN');
  try {
    const branchStmt = db.prepare('INSERT INTO branches(name,city,address,phone,opening_time,closing_time) VALUES(?,?,?,?,?,?)');
    branchStmt.run('Veloura Signature','Islamabad','F-7 Markaz, Islamabad','+92 51 555 0101','09:00','21:00');
    branchStmt.run('Veloura Atelier','Lahore','MM Alam Road, Lahore','+92 42 555 0202','10:00','22:00');
    branchStmt.run('Veloura Studio','Rawalpindi','Bahria Town, Rawalpindi','+92 51 555 0303','09:00','20:00');

    const catStmt = db.prepare('INSERT INTO service_categories(name,slug,icon) VALUES(?,?,?)');
    const cats = [['Hair','hair','✂'],['Makeup','makeup','✦'],['Skin & Facial','skin-facial','◌'],['Nails','nails','◇'],['Spa & Body','spa-body','☾'],['Massage & Wellness','massage-wellness','≈'],['Brows & Lashes','brows-lashes','❋'],['Bridal','bridal','♕'],['Home Services','home-services','⌂']];
    cats.forEach(c=>catStmt.run(...c));
    const catId = Object.fromEntries(db.prepare('SELECT id,slug FROM service_categories').all().map(r=>[r.slug,r.id]));

    const svc = db.prepare('INSERT INTO services(category_id,name,slug,description,price,duration,home_service,rating,image) VALUES(?,?,?,?,?,?,?,?,?)');
    const img = (q) => `https://images.unsplash.com/photo-${q}?auto=format&fit=crop&w=1200&q=80`;
    const services = [
      ['hair','Signature Haircut & Styling',3500,75,1,'A precision consultation, tailored cut and polished finish.','1560066984-138dadb4c035'],
      ['hair','Balayage Luxe',14500,210,0,'Dimensional hand-painted colour with bond protection and toner.','1522337360788-8b13dee7a37e'],
      ['hair','Keratin Silk Therapy',18000,180,0,'Smoothing treatment for glossy, manageable and frizz-controlled hair.','1527799820374-dcf8d9d4a388'],
      ['hair','Scalp Detox Ritual',5500,60,1,'Deep scalp cleanse, massage and restorative hydration.','1526045478516-99145907023c'],
      ['makeup','HD Party Makeup',8500,90,1,'Camera-ready complexion, customised eyes and long-wear finish.','1487412720507-e7ab37603c6f'],
      ['makeup','Airbrush Glam',12500,120,0,'Weightless airbrush finish for special events and photography.','1512496015851-a90fb38ba796'],
      ['skin-facial','Hydra Glow Facial',9500,75,0,'Deep cleansing, exfoliation, extraction and hydration infusion.','1570172619644-dfd03ed5d881'],
      ['skin-facial','Luxury Brightening Facial',7000,60,1,'Radiance-focused facial with mask, massage and skin finishing.','1571290274554-6a2eaa771e5f'],
      ['nails','Royal Manicure & Gel',4800,60,0,'Detailed grooming, cuticle care, massage and premium gel polish.','1604654894610-df63bc536371'],
      ['nails','Sculpted Nail Extensions',7500,120,0,'Custom-shaped extensions with a clean luxury finish.','1607779097040-26e80aa78e66'],
      ['massage-wellness','Aromatherapy Body Massage',9000,90,1,'A calming full-body ritual using selected aromatic oils and personalised pressure.','1540555700478-4be289fbecef'],
      ['massage-wellness','Swedish Relaxation Massage',9500,90,1,'Long flowing movements ease everyday tension and encourage full-body relaxation.','1515377905703-c4788e51af15'],
      ['massage-wellness','Hot Stone Wellness Ritual',12500,105,0,'Warm basalt stones and measured massage techniques create a deeply comforting ritual.','1600334089648-b0d9d3028eb2'],
      ['massage-wellness','Head, Neck & Shoulder Release',4800,45,1,'Focused pressure and soothing movement for areas that carry everyday tension.','1556760544-74068565f05c'],
      ['massage-wellness','Foot & Leg Renewal Massage',5200,50,1,'A restorative lower-leg and foot ritual designed for comfort after long days.','1519823551278-64ac92734fb1'],
      ['massage-wellness','Deep Tissue Recovery Massage',11000,90,0,'A firmer, targeted massage ritual tailored around muscular tension and comfort.','1544161515-4ab6ce6db874'],
      ['brows-lashes','Lash Lift & Tint',6500,75,0,'Lifted, darker lashes with low-maintenance definition.','1583001931096-959e9a1a6223'],
      ['brows-lashes','Brow Sculpt & Tint',3200,45,1,'Precision shaping, mapping and tinting for balanced brows.','1589710751893-f9a6770ad71b'],
      ['bridal','Bridal Signature Makeup',45000,240,0,'Complete luxury bridal makeup, hair styling and draping.','1519741497674-611481863552'],
      ['home-services','Home Glam Session',15000,150,1,'Premium makeup and styling delivered at your location.','1524504388940-b1c1722653e1']
    ];
    services.forEach((s,i)=>svc.run(catId[s[0]],s[1],slugify(s[1]),s[5],s[2],s[3],s[4],4.7+(i%3)*0.1,img(s[6])));

    const mem = db.prepare('INSERT INTO memberships(name,price_monthly,price_yearly,discount_percent,points_multiplier,benefits) VALUES(?,?,?,?,?,?)');
    mem.run('Silver',2999,29990,5,1.1,'Priority booking|5% services discount|Birthday reward');
    mem.run('Gold',5999,59990,10,1.5,'10% services discount|Priority booking|Complimentary consultation|Product savings');
    mem.run('Platinum',9999,99990,15,2,'15% discount|VIP scheduling|Birthday service|Lounge access|Bridal benefits');
    mem.run('VIP',15999,159990,20,3,'20% discount|Private room preference|Beauty advisor|VIP lounge|Premium care kit');

    const userStmt = db.prepare('INSERT INTO users(name,email,phone,password_hash,role,branch_id,created_at) VALUES(?,?,?,?,?,?,?)');
    const adminId = Number(userStmt.run('Veloura Admin','admin@veloura.test','03000000001',hashPassword('Admin@123'),'admin',1,now()).lastInsertRowid);
    const managerId = Number(userStmt.run('Branch Manager','manager@veloura.test','03000000002',hashPassword('Manager@123'),'manager',1,now()).lastInsertRowid);
    const receptionId = Number(userStmt.run('Front Desk','reception@veloura.test','03000000003',hashPassword('Reception@123'),'receptionist',1,now()).lastInsertRowid);
    const staffUser1 = Number(userStmt.run('Ayla Noor','staff@veloura.test','03000000004',hashPassword('Staff@123'),'staff',1,now()).lastInsertRowid);
    const staffUser2 = Number(userStmt.run('Meher Ali','meher@veloura.test','03000000005',hashPassword('Staff@123'),'staff',1,now()).lastInsertRowid);
    const staffUser3 = Number(userStmt.run('Sana Riaz','sana@veloura.test','03000000006',hashPassword('Staff@123'),'staff',2,now()).lastInsertRowid);
    const customerUser = Number(userStmt.run('Demo Customer','customer@veloura.test','03000000007',hashPassword('Customer@123'),'customer',1,now()).lastInsertRowid);

    const staffStmt = db.prepare('INSERT INTO staff(user_id,branch_id,title,speciality,bio,rating,commission_rate,working_days,start_time,end_time,image) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const st1 = Number(staffStmt.run(staffUser1,1,'Senior Hair Artist','Balayage, colour correction and luxury cuts','Ayla creates refined, wearable hair transformations with a strong focus on hair health.',4.9,12,'1,2,3,4,5,6','09:00','18:00',img('1494790108377-be9c29b29330')).lastInsertRowid);
    const st2 = Number(staffStmt.run(staffUser2,1,'Lead Makeup Artist','Bridal, HD and airbrush makeup','Meher is known for timeless bridal beauty, skin-like bases and polished detailing.',4.9,15,'1,2,3,4,5,6','11:00','20:00',img('1534528741775-53994a69daeb')).lastInsertRowid);
    const st3 = Number(staffStmt.run(staffUser3,2,'Skin & Wellness Expert','Hydra facials, skin consultations and massage','Sana combines careful consultation with relaxing results-driven rituals.',4.8,12,'1,2,3,4,5,6','10:00','19:00',img('1544005313-94ddf0286df2')).lastInsertRowid);
    const allServices = db.prepare('SELECT id,category_id FROM services').all();
    const mapSvc = db.prepare('INSERT OR IGNORE INTO staff_services(staff_id,service_id) VALUES(?,?)');
    allServices.forEach(s=>{
      const slug = db.prepare('SELECT slug FROM service_categories WHERE id=?').get(s.category_id).slug;
      if (['hair','home-services'].includes(slug)) mapSvc.run(st1,s.id);
      if (['makeup','bridal','home-services'].includes(slug)) mapSvc.run(st2,s.id);
      if (['skin-facial','spa-body','massage-wellness','brows-lashes','nails'].includes(slug)) mapSvc.run(st3,s.id);
    });

    const customerId = Number(db.prepare(`INSERT INTO customers(user_id,customer_code,name,email,phone,whatsapp,dob,gender,skin_type,hair_type,allergies,category,loyalty_points,membership_id,favourite_branch_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(customerUser,code('CUS'),'Demo Customer','customer@veloura.test','03000000007','03000000007','1998-08-15','Female','Combination','Wavy','None','Regular',780,2,1,now()).lastInsertRowid);
    db.prepare('INSERT INTO customer_addresses(customer_id,label,address,city,is_default) VALUES(?,?,?,?,1)').run(customerId,'Home','F-10, Islamabad','Islamabad');

    const pkg = db.prepare('INSERT INTO packages(name,slug,description,price,original_price,duration_days,category,image) VALUES(?,?,?,?,?,?,?,?)');
    pkg.run('Monthly Glow Ritual','monthly-glow-ritual','A monthly facial, manicure, blow-dry and brow shaping ritual.',16900,21500,30,'Grooming',img('1560750588-73207b1ef5b8'));
    pkg.run('Bride-to-Be Journey','bride-to-be-journey','Consultation, skin prep, hair trial and bridal-day beauty plan.',89000,110000,120,'Bridal',img('1519741497674-611481863552'));
    pkg.run('Mother & Daughter Day','mother-daughter-day','Two luxury facials, hair styling and classic manicures.',24500,31000,30,'Group',img('1526045478516-99145907023c'));
    pkg.run('Eid Radiance Edit','eid-radiance-edit','Party makeup, styled hair, manicure and brow sculpt.',19900,25500,20,'Seasonal',img('1487412720507-e7ab37603c6f'));

    const prod = db.prepare('INSERT INTO products(branch_id,name,slug,category,brand,description,price,stock,min_stock,image,rating) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const products = [
      ['Repair & Shine Hair Serum','Haircare','Veloura Pro','Lightweight serum for polished ends and humidity control.',3200,32,'1556228578-8c89e6adf883'],
      ['Barrier Restore Moisturiser','Skincare','Maison Derma','Ceramide-rich daily moisturiser for balanced, comfortable skin.',4800,18,'1556229010-6c3f2c9ca5f8'],
      ['Rose Quartz Face Roller','Beauty Tools','Veloura Ritual','Cooling facial massage tool in a protective velvet pouch.',2600,24,'1598440947619-2c35fc9aa908'],
      ['Silk Repair Hair Mask','Haircare','Veloura Pro','Weekly strengthening mask for chemically treated hair.',5200,9,'1522338140262-f46f5913618a'],
      ['Luminous Bridal Setting Mist','Makeup','Atelier Veil','Long-wear setting mist with a fresh, refined finish.',3900,14,'1524504388940-b1c1722653e1'],
      ['Luxury Nail Care Set','Nails','Veloura Ritual','Cuticle oil, glass file and strengthening base treatment.',4500,6,'1604654894610-df63bc536371']
    ];
    products.forEach(p=>prod.run(1,p[0],slugify(p[0]),p[1],p[2],p[3],p[4],p[5],5,img(p[6]),4.8));

    const appt = db.prepare('INSERT INTO appointments(booking_code,customer_id,branch_id,staff_id,appointment_date,start_time,end_time,visit_type,status,notes,total,deposit,payment_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const future = new Date(Date.now()+86400000*2).toISOString().slice(0,10);
    const apptId = Number(appt.run(code('APT'),customerId,1,st1,future,'11:00','12:15','salon','confirmed','Prefers a soft layered finish.',3500,1000,'partial',now()).lastInsertRowid);
    const haircut = db.prepare("SELECT id,price,duration FROM services WHERE slug='signature-haircut-styling'").get();
    db.prepare('INSERT INTO appointment_services(appointment_id,service_id,price,duration) VALUES(?,?,?,?)').run(apptId,haircut.id,haircut.price,haircut.duration);
    db.prepare('INSERT INTO payments(payment_code,customer_id,appointment_id,amount,method,status,created_at) VALUES(?,?,?,?,?,?,?)').run(code('PAY'),customerId,apptId,1000,'Card','paid',now());

    const reviews = db.prepare('INSERT INTO reviews(customer_id,service_id,staff_id,rating,comment,verified,approved,created_at) VALUES(?,?,?,?,?,?,?,?)');
    reviews.run(customerId,haircut.id,st1,5,'The consultation was thoughtful and the finish looked incredibly polished.',1,1,now());
    reviews.run(customerId,db.prepare("SELECT id FROM services WHERE slug='hydra-glow-facial'").get().id,st3,5,'Beautiful space, gentle service and visible glow without irritation.',1,1,now());

    db.prepare('INSERT INTO expenses(branch_id,category,description,amount,expense_date,created_at) VALUES(?,?,?,?,?,?)').run(1,'Supplies','Professional colour and skin supplies',42000,new Date().toISOString().slice(0,10),now());
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('salon_name','Veloura Salon');
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('currency','PKR');
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('booking_deposit_percent','30');

    db.prepare('INSERT INTO audit_logs(user_id,action,entity,details,created_at) VALUES(?,?,?,?,?)').run(adminId,'seed','system','Initial demonstration data created',now());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}


function ensureLatestContent() {
  // Idempotent content upgrades so existing installations also receive new features.
  let category = db.prepare("SELECT * FROM service_categories WHERE slug='massage-wellness'").get();
  if (!category) {
    const id = Number(db.prepare('INSERT INTO service_categories(name,slug,icon) VALUES(?,?,?)').run('Massage & Wellness','massage-wellness','≈').lastInsertRowid);
    category = db.prepare('SELECT * FROM service_categories WHERE id=?').get(id);
  }

  const image = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;
  const massageServices = [
    ['Aromatherapy Body Massage','A calming full-body ritual using selected aromatic oils and personalised pressure.',9000,90,1,4.9,'1540555700478-4be289fbecef'],
    ['Swedish Relaxation Massage','Long flowing movements ease everyday tension and encourage full-body relaxation.',9500,90,1,4.9,'1515377905703-c4788e51af15'],
    ['Hot Stone Wellness Ritual','Warm basalt stones and measured massage techniques create a deeply comforting ritual.',12500,105,0,4.9,'1600334089648-b0d9d3028eb2'],
    ['Head, Neck & Shoulder Release','Focused pressure and soothing movement for areas that carry everyday tension.',4800,45,1,4.8,'1556760544-74068565f05c'],
    ['Foot & Leg Renewal Massage','A restorative lower-leg and foot ritual designed for comfort after long days.',5200,50,1,4.8,'1519823551278-64ac92734fb1'],
    ['Deep Tissue Recovery Massage','A firmer, targeted massage ritual tailored around muscular tension and comfort.',11000,90,0,4.9,'1544161515-4ab6ce6db874']
  ];
  const insertService = db.prepare(`INSERT INTO services(category_id,name,slug,description,price,duration,home_service,rating,image,active)
    VALUES(?,?,?,?,?,?,?,?,?,1)`);
  const updateService = db.prepare(`UPDATE services SET category_id=?,description=?,price=?,duration=?,home_service=?,rating=?,image=?,active=1 WHERE id=?`);
  massageServices.forEach(([name,description,price,duration,home,rating,imageId]) => {
    const slug = slugify(name);
    const existing = db.prepare('SELECT id FROM services WHERE slug=?').get(slug);
    if (existing) updateService.run(category.id,description,price,duration,home,rating,image(imageId),existing.id);
    else insertService.run(category.id,name,slug,description,price,duration,home,rating,image(imageId));
  });

  // Add a dedicated massage professional so the new services have live availability at the signature branch.
  let wellnessUser = db.prepare("SELECT * FROM users WHERE lower(email)='wellness@veloura.test'").get();
  if (!wellnessUser) {
    const userId = Number(db.prepare('INSERT INTO users(name,email,phone,password_hash,role,branch_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('Nayab Khan','wellness@veloura.test','03000000008',hashPassword('Wellness@123'),'staff',1,now()).lastInsertRowid);
    wellnessUser = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  }
  let wellnessProfile = db.prepare('SELECT * FROM staff WHERE user_id=?').get(wellnessUser.id);
  if (!wellnessProfile) {
    const profileId = Number(db.prepare(`INSERT INTO staff(user_id,branch_id,title,speciality,bio,rating,commission_rate,working_days,start_time,end_time,image,active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).run(wellnessUser.id,1,'Senior Massage Therapist','Aromatherapy, Swedish, hot stone and deep tissue massage','Nayab creates composed wellness rituals with thoughtful pressure, privacy and guest comfort at the centre.',4.9,12,'1,2,3,4,5,6','10:00','19:00',image('1494790108377-be9c29b29330')).lastInsertRowid);
    wellnessProfile = db.prepare('SELECT * FROM staff WHERE id=?').get(profileId);
  }

  // Assign massage services to wellness specialists without duplicating mappings.
  const wellnessStaff = db.prepare(`SELECT s.id FROM staff s WHERE lower(COALESCE(s.speciality,'')) LIKE '%massage%' OR lower(COALESCE(s.title,'')) LIKE '%wellness%'`).all();
  const services = db.prepare('SELECT id FROM services WHERE category_id=?').all(category.id);
  const map = db.prepare('INSERT OR IGNORE INTO staff_services(staff_id,service_id) VALUES(?,?)');
  wellnessStaff.forEach(staff => services.forEach(service => map.run(staff.id,service.id)));

  // Broader retail catalogue for the expanded Shop experience. Safe for existing databases.
  const retailProducts = [
    ['Velvet Cleanse Hair Bath','Haircare','Veloura Pro','A gentle salon-grade cleanser for colour-treated and styled hair.',3800,28,5,'1522338140262-f46f5913618a',4.9],
    ['Thermal Defence Styling Veil','Haircare','Veloura Pro','Lightweight heat protection for blow-drying, straightening and curling.',3400,25,5,'1556228720-195a672e8a03',4.9],
    ['Radiance C Serum','Skincare','Maison Derma','Daily antioxidant serum created to support a bright, even-looking complexion.',5900,19,5,'1620916566398-39f1143ab7be',4.9],
    ['Calm Barrier Cleansing Balm','Skincare','Maison Derma','A soft cleansing balm for makeup removal and comfortable post-treatment care.',4600,17,5,'1571781926291-c477ebfd024b',4.8],
    ['Soft Focus Lip & Cheek Tint','Makeup','Atelier Veil','A buildable cream tint for a refined, naturally luminous finish.',3100,22,5,'1596462502278-27bfdc403348',4.9],
    ['Precision Brow Styling Set','Makeup','Atelier Veil','Brow pencil, setting gel and spoolie for polished everyday definition.',4200,13,5,'1512496015851-a90fb38ba796',4.8],
    ['Aromatherapy Body Oil','Wellness','Veloura Ritual','A silky aromatic body oil designed for calming massage and at-home rituals.',4900,20,5,'1544161515-4ab6ce6db874',4.9],
    ['Sleep & Restore Bath Ritual','Wellness','Veloura Ritual','Mineral soak and botanical body care for a quiet evening wellness routine.',5600,12,5,'1600334089648-b0d9d3028eb2',4.8],
    ['Bridal Beauty Preparation Edit','Gift Sets','Veloura Atelier','A premium edit of skin prep, setting mist and finishing essentials.',9800,10,4,'1608248543803-ba4f8c70ae0b',4.9],
    ['The Weekend Glow Gift Box','Gift Sets','Veloura Atelier','A ready-to-gift collection for skin, hair and hand care.',7600,15,5,'1571781926291-c477ebfd024b',4.8],
    ['Sculpt & Cool Facial Tool','Beauty Tools','Veloura Ritual','A cooling facial massage tool for a calm, refreshed at-home ritual.',2900,24,5,'1598440947619-2c35fc9aa908',4.8],
    ['Nourishing Body Crème','Body Care','Veloura Ritual','A rich body moisturiser with a soft finish for daily comfort and glow.',4400,18,5,'1608248543803-ba4f8c70ae0b',4.9],
    ['Silk Hand & Body Polish','Body Care','Veloura Ritual','A refined exfoliating polish created to smooth and prepare the skin.',3900,16,5,'1571781926291-c477ebfd024b',4.8]
  ];
  const insertRetail = db.prepare(`INSERT INTO products(branch_id,name,slug,category,brand,description,price,stock,min_stock,image,rating,active)
    VALUES(1,?,?,?,?,?,?,?,?,?,?,1)`);
  const updateRetail = db.prepare(`UPDATE products SET category=?,brand=?,description=?,price=?,stock=CASE WHEN stock<1 THEN ? ELSE stock END,min_stock=?,image=?,rating=?,active=1 WHERE id=?`);
  retailProducts.forEach(([name,productCategory,brand,description,price,stock,minStock,imageId,rating]) => {
    const productSlug = slugify(name);
    const existingProduct = db.prepare('SELECT id FROM products WHERE slug=?').get(productSlug);
    const productImage = image(imageId);
    if (existingProduct) updateRetail.run(productCategory,brand,description,price,stock,minStock,productImage,rating,existingProduct.id);
    else insertRetail.run(name,productSlug,productCategory,brand,description,price,stock,minStock,productImage,rating);
  });
}

migrate();
seed();
ensureLatestContent();

module.exports = { db, now, hashPassword, verifyPassword, slugify, code };
