const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { db, now, hashPassword, verifyPassword, slugify, code } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'Veloura Salon';
const BUILD_VERSION = 'v9.0.0-responsive-bootstrap';

// Safe defaults are available even when a request fails before the DB middleware.
app.locals.appName = APP_NAME;
app.locals.buildVersion = BUILD_VERSION;
app.locals.currentPath = '/';
app.locals.user = null;
app.locals.customer = null;
app.locals.cartCount = 0;
app.locals.categories = [];
app.locals.csrfToken = '';
app.locals.success = '';
app.locals.error = '';
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('view cache', false);
app.disable('etag');
app.use((req,res,next)=>{
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  res.setHeader('Surrogate-Control','no-store');
  next();
});
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  lastModified: false,
  setHeaders(res){
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
  }
}));

const loginAttempts = new Map();
const money = (value) => `PKR ${Number(value || 0).toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
const dateFmt = (value) => value ? new Intl.DateTimeFormat('en-PK', { day:'2-digit', month:'short', year:'numeric' }).format(new Date(`${String(value).slice(0,10)}T00:00:00`)) : '—';
const dateTimeFmt = (value) => value ? new Intl.DateTimeFormat('en-PK', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(value)) : '—';
const minutesToTime = (minutes) => `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const timeToMinutes = (time) => { const [h,m] = String(time).split(':').map(Number); return h*60+m; };
const normalizePhone = (v) => String(v || '').replace(/\D/g,'').replace(/^92(?=3\d{9}$)/,'0');
const parseCookies = (header='') => Object.fromEntries(header.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('='); return [decodeURIComponent(x.slice(0,i)), decodeURIComponent(x.slice(i+1))];}));
const list = (v) => Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);

function createSession(userId=null) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 7*86400000).toISOString();
  db.prepare('INSERT INTO sessions(token,user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)').run(token,userId,csrf,now(),expires);
  return { token, csrf };
}
function audit(userId, action, entity='', entityId=null, details='') {
  db.prepare('INSERT INTO audit_logs(user_id,action,entity,entity_id,details,created_at) VALUES(?,?,?,?,?,?)').run(userId || null,action,entity,entityId,details,now());
}
function notify({userId=null, customerId=null, title, message, channel='in-app'}) {
  db.prepare('INSERT INTO notifications(user_id,customer_id,title,message,channel,created_at) VALUES(?,?,?,?,?,?)').run(userId,customerId,title,message,channel,now());
}
function customerForUser(userId) { return userId ? db.prepare('SELECT * FROM customers WHERE user_id=?').get(userId) : null; }
function staffForUser(userId) { return userId ? db.prepare('SELECT s.*,u.name,u.email,u.phone,b.name branch_name FROM staff s JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id WHERE s.user_id=?').get(userId) : null; }
function getSetting(key, fallback='') { const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? row.value : fallback; }
function isAuthorizedRole(user, roles) { return user && roles.includes(user.role); }
function branchScope(user) { return user && user.role === 'manager' ? user.branch_id : null; }

app.use((req,res,next)=>{
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  const cookies = parseCookies(req.headers.cookie || '');
  let token = cookies.salonsid;
  let session = token ? db.prepare('SELECT * FROM sessions WHERE token=? AND expires_at>?').get(token,now()) : null;
  if (!session) {
    session = createSession();
    token = session.token;
    res.cookie('salonsid', token, { httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV==='production', maxAge:7*86400000 });
  }
  req.session = session;
  req.user = session.user_id ? db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(session.user_id) : null;
  req.customer = req.user ? customerForUser(req.user.id) : null;
  const cart = db.prepare('SELECT COALESCE(SUM(qty),0) qty FROM cart_items WHERE session_token=?').get(token);
  const categories = db.prepare('SELECT * FROM service_categories ORDER BY id').all();
  res.locals.appName = APP_NAME;
  res.locals.buildVersion = BUILD_VERSION;
  res.locals.user = req.user;
  res.locals.customer = req.customer;
  res.locals.csrfToken = session.csrf;
  res.locals.currentPath = req.path;
  res.locals.cartCount = cart.qty;
  res.locals.categories = categories;
  res.locals.money = money;
  res.locals.dateFmt = dateFmt;
  res.locals.dateTimeFmt = dateTimeFmt;
  res.locals.success = req.query.success || '';
  res.locals.error = req.query.error || '';
  next();
});

app.use((req,res,next)=>{
  if (req.method !== 'POST') return next();
  const token = req.body?._csrf || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrf) return res.status(403).render('public/message', { title:'Security check failed', message:'Please refresh the page and try again.', type:'error' });
  next();
});

function requireAuth(req,res,next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}&error=${encodeURIComponent('Please sign in to continue.')}`);
  next();
}
function allowRoles(...roles) {
  return (req,res,next)=>{
    if (!req.user) return res.redirect('/login?error=Please sign in.');
    if (!roles.includes(req.user.role)) return res.status(403).render('public/message',{title:'Access denied',message:'Your account does not have permission to open this area.',type:'error'});
    next();
  };
}
function requireCustomer(req,res,next) {
  if (!req.user) return res.redirect('/login?error=Please sign in to open your account.');
  if (!req.customer) return res.status(403).render('public/message',{title:'Customer account required',message:'This area is available to customer accounts.',type:'error'});
  next();
}
function findOrCreateCustomer(data, userId=null) {
  const phone = normalizePhone(data.phone);
  const email = String(data.email || '').trim().toLowerCase();
  let customer = userId ? db.prepare('SELECT * FROM customers WHERE user_id=?').get(userId) : null;
  if (!customer && phone) customer = db.prepare('SELECT * FROM customers WHERE phone=?').get(phone);
  if (!customer && email) customer = db.prepare('SELECT * FROM customers WHERE lower(email)=?').get(email);
  if (customer) {
    db.prepare(`UPDATE customers SET name=COALESCE(NULLIF(?,''),name), email=COALESCE(NULLIF(?,''),email), phone=COALESCE(NULLIF(?,''),phone), whatsapp=COALESCE(NULLIF(?,''),whatsapp), user_id=COALESCE(user_id,?) WHERE id=?`)
      .run(data.name || '',email,phone,normalizePhone(data.whatsapp || phone),userId,customer.id);
    return db.prepare('SELECT * FROM customers WHERE id=?').get(customer.id);
  }
  const id = Number(db.prepare(`INSERT INTO customers(user_id,customer_code,name,email,phone,whatsapp,category,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(userId,code('CUS'),data.name || 'Guest Customer',email,phone,normalizePhone(data.whatsapp || phone),'New',now()).lastInsertRowid);
  return db.prepare('SELECT * FROM customers WHERE id=?').get(id);
}
function availableStaff(branchId, serviceIds, date, start, duration, preferredStaffId=null) {
  const weekday = new Date(`${date}T00:00:00`).getDay();
  const end = minutesToTime(timeToMinutes(start)+duration);
  const placeholders = serviceIds.map(()=>'?').join(',');
  let sql = `SELECT s.*,u.name FROM staff s JOIN users u ON u.id=s.user_id
    WHERE s.active=1 AND u.active=1 AND s.branch_id=? AND instr(','||s.working_days||',', ','||?||',')>0`;
  const args=[branchId,String(weekday)];
  if (preferredStaffId) { sql += ' AND s.id=?'; args.push(preferredStaffId); }
  if (serviceIds.length) {
    sql += ` AND (SELECT COUNT(DISTINCT service_id) FROM staff_services ss WHERE ss.staff_id=s.id AND ss.service_id IN (${placeholders}))=?`;
    args.push(...serviceIds,serviceIds.length);
  }
  sql += ' ORDER BY s.rating DESC';
  const candidates = db.prepare(sql).all(...args);
  return candidates.filter(s=>{
    if (timeToMinutes(start) < timeToMinutes(s.start_time) || timeToMinutes(end) > timeToMinutes(s.end_time)) return false;
    const leave = db.prepare(`SELECT 1 FROM staff_leave WHERE staff_id=? AND status='approved' AND ? BETWEEN start_date AND end_date`).get(s.id,date);
    if (leave) return false;
    const overlap = db.prepare(`SELECT 1 FROM appointments WHERE staff_id=? AND appointment_date=? AND status NOT IN ('cancelled','no-show') AND start_time < ? AND end_time > ?`).get(s.id,date,end,start);
    return !overlap;
  });
}
function appointmentDetails(id) {
  const appointment = db.prepare(`SELECT a.*,c.name customer_name,c.email customer_email,c.phone customer_phone,b.name branch_name,u.name staff_name
    FROM appointments a JOIN customers c ON c.id=a.customer_id JOIN branches b ON b.id=a.branch_id
    LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN users u ON u.id=s.user_id WHERE a.id=?`).get(id);
  if (!appointment) return null;
  appointment.services = db.prepare(`SELECT s.name,aps.price,aps.duration FROM appointment_services aps JOIN services s ON s.id=aps.service_id WHERE aps.appointment_id=?`).all(id);
  return appointment;
}

app.get('/version', (req,res)=>res.json({ app: APP_NAME, build: BUILD_VERSION, gallery: 'equal-cards', shop: 'equal-cards', responsive: 'bootstrap-5.3.6' }));

// Public website
app.get('/', (req,res)=>{
  const services = db.prepare(`SELECT s.*,c.name category_name FROM services s JOIN service_categories c ON c.id=s.category_id WHERE s.active=1 ORDER BY s.rating DESC LIMIT 8`).all();
  const experts = db.prepare(`SELECT s.*,u.name,b.name branch_name FROM staff s JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id WHERE s.active=1 ORDER BY s.rating DESC LIMIT 4`).all();
  const packages = db.prepare('SELECT * FROM packages WHERE active=1 ORDER BY id LIMIT 4').all();
  const products = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY rating DESC LIMIT 4').all();
  const reviews = db.prepare(`SELECT r.*,c.name customer_name,s.name service_name FROM reviews r LEFT JOIN customers c ON c.id=r.customer_id LEFT JOIN services s ON s.id=r.service_id WHERE r.approved=1 ORDER BY r.id DESC LIMIT 4`).all();
  const branches = db.prepare('SELECT * FROM branches WHERE active=1').all();
  res.render('public/home',{title:'Luxury Beauty, Personally Curated',services,experts,packages,products,reviews,branches});
});

app.get('/services',(req,res)=>{
  const category=req.query.category||'', search=String(req.query.search||'').trim(), branch=Number(req.query.branch||0), maxPrice=Number(req.query.max_price||0), rating=Number(req.query.rating||0);
  let sql=`SELECT DISTINCT s.*,c.name category_name,c.slug category_slug FROM services s JOIN service_categories c ON c.id=s.category_id LEFT JOIN staff_services ss ON ss.service_id=s.id LEFT JOIN staff st ON st.id=ss.staff_id WHERE s.active=1`;
  const args=[];
  if(category){sql+=' AND c.slug=?';args.push(category);} if(search){sql+=' AND (s.name LIKE ? OR s.description LIKE ?)';args.push(`%${search}%`,`%${search}%`);} if(maxPrice){sql+=' AND s.price<=?';args.push(maxPrice);} if(rating){sql+=' AND s.rating>=?';args.push(rating);} if(branch){sql+=' AND st.branch_id=?';args.push(branch);}
  sql+=' ORDER BY s.rating DESC,s.name';
  const services=db.prepare(sql).all(...args); const branches=db.prepare('SELECT * FROM branches WHERE active=1').all();
  res.render('public/services',{title:'Our Services',services,branches,filters:{category,search,branch,maxPrice,rating}});
});
app.get('/services/:slug',(req,res)=>{
  const service=db.prepare(`SELECT s.*,c.name category_name,c.slug category_slug FROM services s JOIN service_categories c ON c.id=s.category_id WHERE s.slug=? AND s.active=1`).get(req.params.slug);
  if(!service)return res.status(404).render('public/message',{title:'Service not found',message:'This service is unavailable.',type:'error'});
  const experts=db.prepare(`SELECT st.*,u.name,b.name branch_name FROM staff_services ss JOIN staff st ON st.id=ss.staff_id JOIN users u ON u.id=st.user_id JOIN branches b ON b.id=st.branch_id WHERE ss.service_id=? AND st.active=1`).all(service.id);
  const reviews=db.prepare(`SELECT r.*,c.name customer_name FROM reviews r LEFT JOIN customers c ON c.id=r.customer_id WHERE r.service_id=? AND r.approved=1 ORDER BY r.id DESC`).all(service.id);
  const related=db.prepare('SELECT * FROM services WHERE category_id=? AND id<>? AND active=1 LIMIT 4').all(service.category_id,service.id);
  res.render('public/service-detail',{title:service.name,service,experts,reviews,related});
});
app.get('/experts',(req,res)=>{
  const branch=Number(req.query.branch||0), speciality=String(req.query.speciality||'');
  let sql=`SELECT s.*,u.name,u.email,b.name branch_name FROM staff s JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id WHERE s.active=1`; const args=[];
  if(branch){sql+=' AND s.branch_id=?';args.push(branch);} if(speciality){sql+=' AND s.speciality LIKE ?';args.push(`%${speciality}%`);} sql+=' ORDER BY s.rating DESC';
  res.render('public/experts',{title:'Beauty Experts',experts:db.prepare(sql).all(...args),branches:db.prepare('SELECT * FROM branches WHERE active=1').all(),filters:{branch,speciality}});
});
app.get('/packages',(req,res)=>res.render('public/packages',{title:'Beauty Packages',packages:db.prepare('SELECT * FROM packages WHERE active=1 ORDER BY id').all()}));
app.get('/memberships',(req,res)=>res.render('public/memberships',{title:'Membership & Loyalty',memberships:db.prepare('SELECT * FROM memberships WHERE active=1 ORDER BY price_monthly').all()}));
app.post('/memberships/:id/join',requireCustomer,(req,res)=>{
  const membership=db.prepare('SELECT * FROM memberships WHERE id=? AND active=1').get(req.params.id); if(!membership)return res.redirect('/memberships?error=Membership not found.');
  db.prepare('UPDATE customers SET membership_id=? WHERE id=?').run(membership.id,req.customer.id);
  notify({customerId:req.customer.id,userId:req.user.id,title:'Membership activated',message:`Your ${membership.name} membership is now active.`});
  audit(req.user.id,'join_membership','membership',membership.id); res.redirect('/account?success=Membership activated.');
});
app.get('/bridal',(req,res)=>res.render('public/bridal',{title:'Bridal Studio',experts:db.prepare(`SELECT s.*,u.name FROM staff s JOIN users u ON u.id=s.user_id WHERE s.speciality LIKE '%Bridal%' OR s.title LIKE '%Makeup%'`).all()}));
app.post('/bridal', (req,res)=>{
  const customer=findOrCreateCustomer(req.body,req.user?.id||null);
  const total=Number(req.body.total||45000), deposit=Math.round(total*0.3);
  const id=Number(db.prepare(`INSERT INTO bridal_bookings(customer_id,event_type,event_date,venue,package_name,coordinator,total,deposit,balance,status,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(customer.id,req.body.event_type,req.body.event_date,req.body.venue||'',req.body.package_name||'Custom Bridal Journey','To be assigned',total,deposit,total-deposit,'consultation',req.body.notes||'',now()).lastInsertRowid);
  notify({customerId:customer.id,userId:req.user?.id||null,title:'Bridal consultation requested',message:`Your ${req.body.event_type} consultation request has been received.`});
  audit(req.user?.id,'create_bridal_booking','bridal_booking',id); res.redirect(`/bridal?success=${encodeURIComponent('Your bridal consultation request has been submitted.')}`);
});
app.get('/gallery',(req,res)=>res.render('public/gallery',{title:'Transformations & Reviews',reviews:db.prepare(`SELECT r.*,c.name customer_name,s.name service_name,u.name staff_name FROM reviews r LEFT JOIN customers c ON c.id=r.customer_id LEFT JOIN services s ON s.id=r.service_id LEFT JOIN staff st ON st.id=r.staff_id LEFT JOIN users u ON u.id=st.user_id WHERE r.approved=1 ORDER BY r.id DESC`).all()}));

// Shop and cart
app.get('/shop',(req,res)=>{
  const search=String(req.query.search||''),category=String(req.query.category||''); let sql='SELECT * FROM products WHERE active=1';const args=[];
  if(search){sql+=' AND (name LIKE ? OR description LIKE ? OR brand LIKE ?)';args.push(`%${search}%`,`%${search}%`,`%${search}%`);} if(category){sql+=' AND category=?';args.push(category);} sql+=' ORDER BY rating DESC,name';
  const categories=db.prepare('SELECT DISTINCT category FROM products WHERE active=1 ORDER BY category').all();res.render('public/shop',{title:'Beauty Shop',products:db.prepare(sql).all(...args),productCategories:categories,filters:{search,category}});
});
app.get('/product/:slug',(req,res)=>{
  const product=db.prepare('SELECT * FROM products WHERE slug=? AND active=1').get(req.params.slug);if(!product)return res.status(404).render('public/message',{title:'Product not found',message:'This product is unavailable.',type:'error'});
  const related=db.prepare('SELECT * FROM products WHERE category=? AND id<>? AND active=1 LIMIT 4').all(product.category,product.id);res.render('public/product-detail',{title:product.name,product,related});
});
app.post('/cart/add',(req,res)=>{
  const product=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(req.body.product_id)); if(!product || product.stock<1)return res.redirect('/shop?error=Product is unavailable.');
  const qty=Math.max(1,Math.min(Number(req.body.qty||1),product.stock));
  db.prepare(`INSERT INTO cart_items(session_token,user_id,product_id,qty) VALUES(?,?,?,?) ON CONFLICT(session_token,product_id) DO UPDATE SET qty=MIN(qty+excluded.qty,?)`).run(req.session.token,req.user?.id||null,product.id,qty,product.stock);
  res.redirect(`/cart?success=${encodeURIComponent(`${product.name} added to cart.`)}`);
});
app.get('/cart',(req,res)=>{
  const items=db.prepare(`SELECT ci.*,p.name,p.slug,p.price,p.stock,p.image,(ci.qty*p.price) subtotal FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.session_token=?`).all(req.session.token);
  const total=items.reduce((a,x)=>a+x.subtotal,0);res.render('public/cart',{title:'Your Cart',items,total});
});
app.post('/cart/update',(req,res)=>{
  const id=Number(req.body.item_id),qty=Number(req.body.qty||0); if(qty<=0)db.prepare('DELETE FROM cart_items WHERE id=? AND session_token=?').run(id,req.session.token); else db.prepare(`UPDATE cart_items SET qty=MIN(?,(SELECT stock FROM products WHERE id=cart_items.product_id)) WHERE id=? AND session_token=?`).run(qty,id,req.session.token);res.redirect('/cart');
});
app.post('/checkout',(req,res)=>{
  const items=db.prepare(`SELECT ci.*,p.name,p.price,p.stock,(ci.qty*p.price) subtotal FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.session_token=?`).all(req.session.token);
  if(!items.length)return res.redirect('/cart?error=Your cart is empty.'); if(items.some(x=>x.qty>x.stock))return res.redirect('/cart?error=Some items do not have enough stock.');
  const customer=findOrCreateCustomer(req.body,req.user?.id||null);const total=items.reduce((a,x)=>a+x.subtotal,0);let orderId;
  db.exec('BEGIN IMMEDIATE');try{
    orderId=Number(db.prepare(`INSERT INTO orders(order_code,customer_id,total,status,payment_method,payment_status,fulfillment,address,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(code('ORD'),customer.id,total,'processing',req.body.payment_method||'Card','paid',req.body.fulfillment||'delivery',req.body.address||'',now()).lastInsertRowid);
    const orderItem=db.prepare('INSERT INTO order_items(order_id,product_id,qty,price) VALUES(?,?,?,?)');const stock=db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?');const move=db.prepare('INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason,created_at) VALUES(?,?,?,?,?,?)');
    for(const item of items){const result=stock.run(item.qty,item.product_id,item.qty);if(result.changes!==1)throw new Error('Stock changed during checkout');orderItem.run(orderId,item.product_id,item.qty,item.price);move.run(item.product_id,1,'sale',-item.qty,`Order #${orderId}`,now());}
    db.prepare('INSERT INTO payments(payment_code,customer_id,order_id,amount,method,status,created_at) VALUES(?,?,?,?,?,?,?)').run(code('PAY'),customer.id,orderId,total,req.body.payment_method||'Card','paid',now());
    db.prepare('UPDATE customers SET total_spent=total_spent+?,loyalty_points=loyalty_points+? WHERE id=?').run(total,Math.floor(total/100),customer.id);db.prepare('DELETE FROM cart_items WHERE session_token=?').run(req.session.token);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');return res.redirect('/cart?error=Checkout could not be completed. Please try again.');}
  notify({customerId:customer.id,userId:req.user?.id||null,title:'Order confirmed',message:`Your beauty order has been confirmed and is being prepared.`});audit(req.user?.id,'create_order','order',orderId,`Total ${total}`);res.redirect(`/order-success/${orderId}`);
});
app.get('/order-success/:id',(req,res)=>{const order=db.prepare(`SELECT o.*,c.name FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=?`).get(req.params.id);if(!order)return res.redirect('/shop');res.render('public/order-success',{title:'Order Confirmed',order});});

// Gift cards
app.get('/gift-cards',(req,res)=>res.render('public/gift-cards',{title:'Gift Cards'}));
app.post('/gift-cards',(req,res)=>{
  const amount=Math.max(1000,Number(req.body.amount||0));const customer=findOrCreateCustomer(req.body,req.user?.id||null);const expires=new Date(Date.now()+365*86400000).toISOString();const giftCode=`VL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const id=Number(db.prepare(`INSERT INTO gift_cards(code,purchaser_customer_id,recipient_name,recipient_email,message,initial_amount,balance,expires_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(giftCode,customer.id,req.body.recipient_name,req.body.recipient_email,req.body.message||'',amount,amount,expires,'active',now()).lastInsertRowid);
  db.prepare('INSERT INTO payments(payment_code,customer_id,amount,method,status,reference,created_at) VALUES(?,?,?,?,?,?,?)').run(code('PAY'),customer.id,amount,req.body.payment_method||'Card','paid',`Gift card ${giftCode}`,now());audit(req.user?.id,'purchase_gift_card','gift_card',id);res.render('public/gift-success',{title:'Gift Card Ready',gift:{id,code:giftCode,amount,recipient_name:req.body.recipient_name,recipient_email:req.body.recipient_email}});
});

// Booking
app.get('/book',(req,res)=>{
  const services=db.prepare(`SELECT s.*,c.name category_name FROM services s JOIN service_categories c ON c.id=s.category_id WHERE s.active=1 ORDER BY c.id,s.name`).all();
  const branches=db.prepare('SELECT * FROM branches WHERE active=1 ORDER BY name').all();
  const staff=db.prepare(`SELECT s.*,u.name,b.name branch_name FROM staff s JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id WHERE s.active=1 ORDER BY u.name`).all();
  res.render('public/book',{title:'Book an Appointment',services,branches,staff,selectedService:Number(req.query.service||0),today:new Date().toISOString().slice(0,10)});
});
app.get('/api/availability',(req,res)=>{
  const branchId=Number(req.query.branch_id),staffId=Number(req.query.staff_id||0),date=req.query.date;const serviceIds=String(req.query.service_ids||'').split(',').map(Number).filter(Boolean);
  if(!branchId||!date||!serviceIds.length)return res.json({slots:[]});
  const svcs=db.prepare(`SELECT id,duration FROM services WHERE id IN (${serviceIds.map(()=>'?').join(',')})`).all(...serviceIds);const duration=svcs.reduce((a,s)=>a+s.duration,0);const branch=db.prepare('SELECT * FROM branches WHERE id=?').get(branchId);if(!branch)return res.json({slots:[]});
  const slots=[];for(let t=timeToMinutes(branch.opening_time);t+duration<=timeToMinutes(branch.closing_time);t+=30){const time=minutesToTime(t);const staff=availableStaff(branchId,serviceIds,date,time,duration,staffId||null);if(staff.length)slots.push({time,label:time,staff:staff.map(s=>({id:s.id,name:s.name}))});}
  res.json({duration,slots});
});
app.post('/book',(req,res)=>{
  const serviceIds=list(req.body.service_ids).map(Number).filter(Boolean);if(!serviceIds.length)return res.redirect('/book?error=Select at least one service.');
  const services=db.prepare(`SELECT * FROM services WHERE active=1 AND id IN (${serviceIds.map(()=>'?').join(',')})`).all(...serviceIds);if(services.length!==serviceIds.length)return res.redirect('/book?error=One or more services are unavailable.');
  const date=req.body.appointment_date,start=req.body.start_time,branchId=Number(req.body.branch_id),preferred=Number(req.body.staff_id||0)||null;if(!date||date<new Date().toISOString().slice(0,10)||!start||!branchId)return res.redirect('/book?error=Choose a valid branch, date and time.');
  const customer=findOrCreateCustomer(req.body,req.user?.id||null);const duration=services.reduce((a,s)=>a+s.duration,0);const staff=availableStaff(branchId,serviceIds,date,start,duration,preferred)[0];if(!staff)return res.redirect('/book?error=That time is no longer available. Please choose another slot.');
  const membership=customer.membership_id?db.prepare('SELECT * FROM memberships WHERE id=?').get(customer.membership_id):null;const subtotal=services.reduce((a,s)=>a+s.price,0);const discount=membership?subtotal*(membership.discount_percent/100):0;const homeFee=req.body.visit_type==='home'?1500:0;const total=Math.max(0,subtotal-discount+homeFee);const depositPercent=Number(getSetting('booking_deposit_percent','30'));const deposit=req.body.payment_option==='full'?total:Math.round(total*depositPercent/100);const end=minutesToTime(timeToMinutes(start)+duration);let appointmentId,bookingCode=code('APT');
  db.exec('BEGIN IMMEDIATE');try{
    const stillAvailable=availableStaff(branchId,serviceIds,date,start,duration,staff.id)[0];if(!stillAvailable)throw new Error('Conflict');
    appointmentId=Number(db.prepare(`INSERT INTO appointments(booking_code,customer_id,branch_id,staff_id,appointment_date,start_time,end_time,visit_type,address,status,notes,total,deposit,payment_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(bookingCode,customer.id,branchId,staff.id,date,start,end,req.body.visit_type||'salon',req.body.address||'','confirmed',req.body.notes||'',total,deposit,deposit>=total?'paid':'partial',now()).lastInsertRowid);
    const aps=db.prepare('INSERT INTO appointment_services(appointment_id,service_id,price,duration) VALUES(?,?,?,?)');services.forEach(s=>aps.run(appointmentId,s.id,s.price,s.duration));
    if(deposit>0)db.prepare('INSERT INTO payments(payment_code,customer_id,appointment_id,amount,method,status,reference,created_at) VALUES(?,?,?,?,?,?,?,?)').run(code('PAY'),customer.id,appointmentId,deposit,req.body.payment_method||'Card','paid','Sandbox payment',now());
    db.prepare('UPDATE customers SET pending_balance=pending_balance+?,preferred_staff_id=COALESCE(preferred_staff_id,?),favourite_branch_id=COALESCE(favourite_branch_id,?) WHERE id=?').run(total-deposit,staff.id,branchId,customer.id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');return res.redirect('/book?error=This slot was just booked. Please select another time.');}
  notify({customerId:customer.id,userId:req.user?.id||null,title:'Appointment confirmed',message:`Booking ${bookingCode} is confirmed for ${date} at ${start}.`});notify({userId:staff.user_id,title:'New appointment',message:`A new booking has been assigned for ${date} at ${start}.`});audit(req.user?.id,'create_appointment','appointment',appointmentId,bookingCode);res.redirect(`/booking-success/${bookingCode}`);
});
app.get('/booking-success/:code',(req,res)=>{const appointment=db.prepare(`SELECT a.*,c.name customer_name,b.name branch_name,u.name staff_name FROM appointments a JOIN customers c ON c.id=a.customer_id JOIN branches b ON b.id=a.branch_id LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN users u ON u.id=s.user_id WHERE a.booking_code=?`).get(req.params.code);if(!appointment)return res.redirect('/book');appointment.services=db.prepare(`SELECT s.name FROM appointment_services aps JOIN services s ON s.id=aps.service_id WHERE aps.appointment_id=?`).all(appointment.id);res.render('public/booking-success',{title:'Appointment Confirmed',appointment});});

// Authentication
app.get('/login',(req,res)=>res.render('auth/login',{title:'Sign In',next:req.query.next||''}));
app.post('/login',(req,res)=>{
  const key=req.ip;const record=loginAttempts.get(key)||{count:0,until:0};if(record.until>Date.now())return res.redirect('/login?error=Too many attempts. Please try again shortly.');
  const email=String(req.body.email||'').toLowerCase().trim();const user=db.prepare('SELECT * FROM users WHERE lower(email)=? AND active=1').get(email);
  if(!user||!verifyPassword(req.body.password||'',user.password_hash)){record.count++;if(record.count>=5){record.until=Date.now()+5*60000;record.count=0;}loginAttempts.set(key,record);audit(user?.id,'login_failed','user',user?.id,null);return res.redirect('/login?error=Invalid email or password.');}
  loginAttempts.delete(key);db.prepare('UPDATE sessions SET user_id=? WHERE token=?').run(user.id,req.session.token);db.prepare('UPDATE cart_items SET user_id=? WHERE session_token=?').run(user.id,req.session.token);audit(user.id,'login','user',user.id);const requested=String(req.body.next||'');const safeNext=requested.startsWith('/')&&!requested.startsWith('//')?requested:'';const next=safeNext||({admin:'/admin',manager:'/admin',receptionist:'/admin/appointments',staff:'/staff'}[user.role]||'/account');res.redirect(next);
});
app.get('/register',(req,res)=>res.render('auth/register',{title:'Create Account'}));
app.post('/register',(req,res)=>{
  const name=String(req.body.name||'').trim(),email=String(req.body.email||'').trim().toLowerCase(),phone=normalizePhone(req.body.phone),password=String(req.body.password||'');
  if(name.length<2||!email.includes('@')||phone.length<10||password.length<8)return res.redirect('/register?error=Enter valid details and a password of at least 8 characters.');
  if(db.prepare('SELECT 1 FROM users WHERE lower(email)=? OR phone=?').get(email,phone))return res.redirect('/login?error=An account already exists with this email or phone.');
  let userId;try{userId=Number(db.prepare('INSERT INTO users(name,email,phone,password_hash,role,branch_id,created_at) VALUES(?,?,?,?,?,?,?)').run(name,email,phone,hashPassword(password),'customer',null,now()).lastInsertRowid);findOrCreateCustomer({name,email,phone,whatsapp:phone},userId);}catch(e){return res.redirect('/register?error=Account could not be created.');}
  db.prepare('UPDATE sessions SET user_id=? WHERE token=?').run(userId,req.session.token);audit(userId,'register','user',userId);res.redirect('/account?success=Welcome to Veloura. Your account is ready.');
});
app.get('/logout',(req,res)=>{if(req.user)audit(req.user.id,'logout','user',req.user.id);db.prepare('UPDATE sessions SET user_id=NULL WHERE token=?').run(req.session.token);res.redirect('/?success=You have signed out.');});

// Customer portal
app.get('/account',requireCustomer,(req,res)=>{
  const upcoming=db.prepare(`SELECT a.*,b.name branch_name,u.name staff_name,GROUP_CONCAT(sv.name, ', ') services FROM appointments a JOIN branches b ON b.id=a.branch_id LEFT JOIN staff st ON st.id=a.staff_id LEFT JOIN users u ON u.id=st.user_id LEFT JOIN appointment_services aps ON aps.appointment_id=a.id LEFT JOIN services sv ON sv.id=aps.service_id WHERE a.customer_id=? AND a.appointment_date>=date('now') AND a.status NOT IN ('cancelled','completed') GROUP BY a.id ORDER BY a.appointment_date,a.start_time LIMIT 3`).all(req.customer.id);
  const recentOrders=db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 3').all(req.customer.id);const membership=req.customer.membership_id?db.prepare('SELECT * FROM memberships WHERE id=?').get(req.customer.membership_id):null;const unread=db.prepare('SELECT COUNT(*) c FROM notifications WHERE customer_id=? AND read_at IS NULL').get(req.customer.id).c;
  res.render('customer/dashboard',{title:'My Beauty Dashboard',upcoming,recentOrders,membership,unread});
});
app.get('/account/appointments',requireCustomer,(req,res)=>{
  const appointments=db.prepare(`SELECT a.*,b.name branch_name,u.name staff_name,GROUP_CONCAT(sv.name, ', ') services FROM appointments a JOIN branches b ON b.id=a.branch_id LEFT JOIN staff st ON st.id=a.staff_id LEFT JOIN users u ON u.id=st.user_id LEFT JOIN appointment_services aps ON aps.appointment_id=a.id LEFT JOIN services sv ON sv.id=aps.service_id WHERE a.customer_id=? GROUP BY a.id ORDER BY a.appointment_date DESC,a.start_time DESC`).all(req.customer.id);res.render('customer/appointments',{title:'My Appointments',appointments});
});
app.post('/account/appointments/:id/cancel',requireCustomer,(req,res)=>{
  const appt=db.prepare(`SELECT * FROM appointments WHERE id=? AND customer_id=?`).get(req.params.id,req.customer.id);if(!appt)return res.redirect('/account/appointments?error=Appointment not found.');if(['completed','cancelled'].includes(appt.status))return res.redirect('/account/appointments?error=This appointment cannot be cancelled.');
  db.prepare(`UPDATE appointments SET status='cancelled' WHERE id=?`).run(appt.id);db.prepare('UPDATE customers SET pending_balance=MAX(0,pending_balance-?) WHERE id=?').run(appt.total-appt.deposit,req.customer.id);notify({customerId:req.customer.id,userId:req.user.id,title:'Appointment cancelled',message:`Booking ${appt.booking_code} has been cancelled.`});audit(req.user.id,'cancel_appointment','appointment',appt.id);res.redirect('/account/appointments?success=Appointment cancelled and the time slot has been released.');
});
app.post('/account/appointments/:id/reschedule',requireCustomer,(req,res)=>{
  const appt=db.prepare('SELECT * FROM appointments WHERE id=? AND customer_id=?').get(req.params.id,req.customer.id);if(!appt)return res.redirect('/account/appointments?error=Appointment not found.');const services=db.prepare('SELECT service_id,duration FROM appointment_services WHERE appointment_id=?').all(appt.id);const serviceIds=services.map(x=>x.service_id),duration=services.reduce((a,x)=>a+x.duration,0);const date=req.body.appointment_date,start=req.body.start_time;
  const staff=availableStaff(appt.branch_id,serviceIds,date,start,duration,appt.staff_id)[0];if(!staff)return res.redirect('/account/appointments?error=The selected time is unavailable.');db.prepare('UPDATE appointments SET appointment_date=?,start_time=?,end_time=? WHERE id=?').run(date,start,minutesToTime(timeToMinutes(start)+duration),appt.id);notify({customerId:req.customer.id,userId:req.user.id,title:'Appointment rescheduled',message:`Booking ${appt.booking_code} is now set for ${date} at ${start}.`});audit(req.user.id,'reschedule_appointment','appointment',appt.id);res.redirect('/account/appointments?success=Appointment rescheduled.');
});
app.get('/account/orders',requireCustomer,(req,res)=>{const orders=db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC').all(req.customer.id);res.render('customer/orders',{title:'My Orders',orders});});
app.get('/account/profile',requireCustomer,(req,res)=>{const addresses=db.prepare('SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC').all(req.customer.id);const branches=db.prepare('SELECT * FROM branches WHERE active=1').all();const experts=db.prepare(`SELECT s.id,u.name FROM staff s JOIN users u ON u.id=s.user_id WHERE s.active=1 ORDER BY u.name`).all();res.render('customer/profile',{title:'Profile & Preferences',addresses,branches,experts});});
app.post('/account/profile',requireCustomer,(req,res)=>{
  const phone=normalizePhone(req.body.phone),email=String(req.body.email||'').trim().toLowerCase();const duplicate=db.prepare('SELECT id FROM customers WHERE id<>? AND ((phone<>\'\' AND phone=?) OR (email<>\'\' AND lower(email)=?))').get(req.customer.id,phone,email);if(duplicate)return res.redirect('/account/profile?error=Another customer already uses this email or phone.');
  db.prepare(`UPDATE customers SET name=?,email=?,phone=?,whatsapp=?,dob=?,gender=?,skin_type=?,hair_type=?,allergies=?,sensitivities=?,preferred_staff_id=?,favourite_branch_id=? WHERE id=?`).run(req.body.name,email,phone,normalizePhone(req.body.whatsapp),req.body.dob||null,req.body.gender||'',req.body.skin_type||'',req.body.hair_type||'',req.body.allergies||'',req.body.sensitivities||'',Number(req.body.preferred_staff_id)||null,Number(req.body.favourite_branch_id)||null,req.customer.id);
  db.prepare('UPDATE users SET name=?,email=?,phone=? WHERE id=?').run(req.body.name,email,phone,req.user.id);if(req.body.address){db.prepare('INSERT INTO customer_addresses(customer_id,label,address,city,is_default) VALUES(?,?,?,?,?)').run(req.customer.id,req.body.address_label||'Home',req.body.address,req.body.city||'',req.body.is_default?1:0);}audit(req.user.id,'update_profile','customer',req.customer.id);res.redirect('/account/profile?success=Profile updated.');
});
app.get('/account/loyalty',requireCustomer,(req,res)=>{const membership=req.customer.membership_id?db.prepare('SELECT * FROM memberships WHERE id=?').get(req.customer.membership_id):null;res.render('customer/loyalty',{title:'Membership & Loyalty',membership,memberships:db.prepare('SELECT * FROM memberships WHERE active=1').all()});});
app.get('/account/library',requireCustomer,(req,res)=>{const consultations=db.prepare('SELECT * FROM consultations WHERE customer_id=? ORDER BY id DESC').all(req.customer.id);const giftCards=db.prepare('SELECT * FROM gift_cards WHERE purchaser_customer_id=? ORDER BY id DESC').all(req.customer.id);const wishlist=db.prepare(`SELECT p.* FROM wishlists w JOIN products p ON p.id=w.product_id WHERE w.customer_id=? ORDER BY w.created_at DESC`).all(req.customer.id);res.render('customer/library',{title:'Saved, Gifts & Consultations',consultations,giftCards,wishlist});});
app.get('/account/notifications',requireCustomer,(req,res)=>{const notifications=db.prepare('SELECT * FROM notifications WHERE customer_id=? OR user_id=? ORDER BY id DESC').all(req.customer.id,req.user.id);db.prepare('UPDATE notifications SET read_at=? WHERE (customer_id=? OR user_id=?) AND read_at IS NULL').run(now(),req.customer.id,req.user.id);res.render('customer/notifications',{title:'Notifications',notifications});});
app.post('/account/reviews',requireCustomer,(req,res)=>{const completed=db.prepare(`SELECT 1 FROM appointments a JOIN appointment_services aps ON aps.appointment_id=a.id WHERE a.customer_id=? AND a.status='completed' AND aps.service_id=?`).get(req.customer.id,Number(req.body.service_id));const id=Number(db.prepare('INSERT INTO reviews(customer_id,service_id,staff_id,rating,comment,verified,approved,created_at) VALUES(?,?,?,?,?,?,?,?)').run(req.customer.id,Number(req.body.service_id)||null,Number(req.body.staff_id)||null,Math.max(1,Math.min(5,Number(req.body.rating||5))),req.body.comment||'',completed?1:0,1,now()).lastInsertRowid);audit(req.user.id,'create_review','review',id);res.redirect('/gallery?success=Thank you for sharing your review.');});
app.post('/account/consultation',requireCustomer,(req,res)=>{const id=Number(db.prepare(`INSERT INTO consultations(customer_id,staff_id,skin_concerns,hair_concerns,goals,allergies,previous_treatments,recommendation,patch_test,consent,follow_up_date,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.customer.id,Number(req.body.staff_id)||null,req.body.skin_concerns||'',req.body.hair_concerns||'',req.body.goals||'',req.body.allergies||'',req.body.previous_treatments||'','','Pending',req.body.consent?1:0,req.body.follow_up_date||null,now()).lastInsertRowid);audit(req.user.id,'create_consultation','consultation',id);res.redirect('/account?success=Your consultation details have been saved.');});
app.post('/wishlist/:id',requireCustomer,(req,res)=>{db.prepare('INSERT OR IGNORE INTO wishlists(customer_id,product_id,created_at) VALUES(?,?,?)').run(req.customer.id,Number(req.params.id),now());res.redirect(req.get('referer')||'/shop');});

// Staff portal
app.get('/staff',allowRoles('staff'),(req,res)=>{const staff=staffForUser(req.user.id);const today=new Date().toISOString().slice(0,10);const appointments=db.prepare(`SELECT a.*,c.name customer_name,c.phone customer_phone,GROUP_CONCAT(sv.name, ', ') services FROM appointments a JOIN customers c ON c.id=a.customer_id LEFT JOIN appointment_services aps ON aps.appointment_id=a.id LEFT JOIN services sv ON sv.id=aps.service_id WHERE a.staff_id=? AND a.appointment_date>=? GROUP BY a.id ORDER BY a.appointment_date,a.start_time`).all(staff.id,today);const commission=db.prepare(`SELECT COALESCE(SUM(a.total*?/100),0) total FROM appointments a WHERE a.staff_id=? AND a.status='completed' AND strftime('%Y-%m',a.appointment_date)=strftime('%Y-%m','now')`).get(staff.commission_rate,staff.id).total;const leave=db.prepare('SELECT * FROM staff_leave WHERE staff_id=? ORDER BY id DESC LIMIT 5').all(staff.id);res.render('staff/dashboard',{title:'Staff Workspace',staff,appointments,commission,leave,today});});
app.post('/staff/appointments/:id/status',allowRoles('staff'),(req,res)=>{const staff=staffForUser(req.user.id);const appt=db.prepare('SELECT * FROM appointments WHERE id=? AND staff_id=?').get(req.params.id,staff.id);if(!appt)return res.redirect('/staff?error=Appointment not found.');const allowed=['checked-in','in-service','paused','completed','needs-follow-up'];if(!allowed.includes(req.body.status))return res.redirect('/staff?error=Invalid status.');db.prepare('UPDATE appointments SET status=? WHERE id=?').run(req.body.status,appt.id);if(req.body.status==='completed'&&appt.status!=='completed'){db.prepare('UPDATE customers SET last_visit=?,total_spent=total_spent+?,pending_balance=MAX(0,pending_balance-?),loyalty_points=loyalty_points+? WHERE id=?').run(appt.appointment_date,appt.total,appt.total-appt.deposit,Math.floor(appt.total/100),appt.customer_id);}notify({customerId:appt.customer_id,title:'Appointment update',message:`Your appointment ${appt.booking_code} status is now ${req.body.status}.`});audit(req.user.id,'update_appointment_status','appointment',appt.id,req.body.status);res.redirect('/staff?success=Appointment status updated.');});
app.post('/staff/appointments/:id/notes',allowRoles('staff'),(req,res)=>{const staff=staffForUser(req.user.id);const appt=db.prepare('SELECT * FROM appointments WHERE id=? AND staff_id=?').get(req.params.id,staff.id);if(!appt)return res.redirect('/staff?error=Appointment not found.');db.prepare('INSERT INTO appointment_notes(appointment_id,staff_id,note,formula,used_products,created_at) VALUES(?,?,?,?,?,?)').run(appt.id,staff.id,req.body.note||'',req.body.formula||'',req.body.used_products||'',now());audit(req.user.id,'add_treatment_notes','appointment',appt.id);res.redirect('/staff?success=Treatment notes saved.');});
app.post('/staff/leave',allowRoles('staff'),(req,res)=>{const staff=staffForUser(req.user.id);const id=Number(db.prepare('INSERT INTO staff_leave(staff_id,start_date,end_date,reason,status,created_at) VALUES(?,?,?,?,?,?)').run(staff.id,req.body.start_date,req.body.end_date,req.body.reason||'','pending',now()).lastInsertRowid);notify({userId:req.user.id,title:'Leave request submitted',message:'Your leave request is waiting for manager approval.'});audit(req.user.id,'request_leave','staff_leave',id);res.redirect('/staff?success=Leave request submitted.');});
app.post('/staff/attendance',allowRoles('staff'),(req,res)=>{const staff=staffForUser(req.user.id),date=new Date().toISOString().slice(0,10),time=new Date().toTimeString().slice(0,5);const existing=db.prepare('SELECT * FROM staff_attendance WHERE staff_id=? AND date=?').get(staff.id,date);if(!existing)db.prepare('INSERT INTO staff_attendance(staff_id,date,check_in,status) VALUES(?,?,?,?)').run(staff.id,date,time,'present');else db.prepare('UPDATE staff_attendance SET check_out=? WHERE id=?').run(time,existing.id);res.redirect('/staff?success=Attendance updated.');});

// Admin and management
app.use('/admin',allowRoles('admin','manager','receptionist'));
app.get('/admin',(req,res)=>{
  const scope=branchScope(req.user),today=new Date().toISOString().slice(0,10);const where=scope?' WHERE branch_id=?':'';const args=scope?[scope]:[];
  const stats={todayAppointments:db.prepare(`SELECT COUNT(*) c FROM appointments WHERE appointment_date=? ${scope?'AND branch_id=?':''}`).get(today,...args).c,pending:db.prepare(`SELECT COUNT(*) c FROM appointments WHERE status IN ('confirmed','pending') ${scope?'AND branch_id=?':''}`).get(...args).c,revenue:db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments ${scope?'WHERE appointment_id IN (SELECT id FROM appointments WHERE branch_id=?)':''}`).get(...args).v,customers:db.prepare('SELECT COUNT(*) c FROM customers').get().c,lowStock:db.prepare(`SELECT COUNT(*) c FROM products WHERE stock<=min_stock ${scope?'AND branch_id=?':''}`).get(...args).c,bridal:db.prepare("SELECT COUNT(*) c FROM bridal_bookings WHERE status NOT IN ('completed','cancelled')").get().c};
  const appointments=db.prepare(`SELECT a.*,c.name customer_name,b.name branch_name,u.name staff_name FROM appointments a JOIN customers c ON c.id=a.customer_id JOIN branches b ON b.id=a.branch_id LEFT JOIN staff s ON s.id=a.staff_id LEFT JOIN users u ON u.id=s.user_id ${scope?'WHERE a.branch_id=?':''} ORDER BY a.appointment_date DESC,a.start_time DESC LIMIT 8`).all(...args);
  const topServices=db.prepare(`SELECT s.name,COUNT(*) bookings,COALESCE(SUM(aps.price),0) revenue FROM appointment_services aps JOIN services s ON s.id=aps.service_id JOIN appointments a ON a.id=aps.appointment_id ${scope?'WHERE a.branch_id=?':''} GROUP BY s.id ORDER BY bookings DESC LIMIT 5`).all(...args);
  const recent=db.prepare('SELECT al.*,u.name user_name FROM audit_logs al LEFT JOIN users u ON u.id=al.user_id ORDER BY al.id DESC LIMIT 8').all();res.render('admin/dashboard',{title:'Admin Overview',stats,appointments,topServices,recent,scope});
});
app.get('/admin/customers',(req,res)=>{const search=String(req.query.search||'');let sql=`SELECT c.*,m.name membership_name,u2.name preferred_staff_name FROM customers c LEFT JOIN memberships m ON m.id=c.membership_id LEFT JOIN staff s ON s.id=c.preferred_staff_id LEFT JOIN users u2 ON u2.id=s.user_id WHERE 1=1`;const args=[];if(search){sql+=` AND (c.name LIKE ? OR c.phone LIKE ? OR c.whatsapp LIKE ? OR c.email LIKE ? OR c.customer_code LIKE ? OR EXISTS(SELECT 1 FROM appointments a WHERE a.customer_id=c.id AND a.booking_code LIKE ?) OR EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=c.id AND o.order_code LIKE ?))`;args.push(...Array(7).fill(`%${search}%`));}sql+=' ORDER BY c.id DESC';res.render('admin/customers',{title:'Customer Management',customers:db.prepare(sql).all(...args),search});});
app.get('/admin/customers/:id',(req,res)=>{const customer=db.prepare(`SELECT c.*,m.name membership_name,u.name preferred_staff_name,b.name favourite_branch_name FROM customers c LEFT JOIN memberships m ON m.id=c.membership_id LEFT JOIN staff s ON s.id=c.preferred_staff_id LEFT JOIN users u ON u.id=s.user_id LEFT JOIN branches b ON b.id=c.favourite_branch_id WHERE c.id=?`).get(req.params.id);if(!customer)return res.redirect('/admin/customers?error=Customer not found.');const appointments=db.prepare(`SELECT a.*,b.name branch_name,u.name staff_name,GROUP_CONCAT(sv.name, ', ') services FROM appointments a JOIN branches b ON b.id=a.branch_id LEFT JOIN staff st ON st.id=a.staff_id LEFT JOIN users u ON u.id=st.user_id LEFT JOIN appointment_services aps ON aps.appointment_id=a.id LEFT JOIN services sv ON sv.id=aps.service_id WHERE a.customer_id=? GROUP BY a.id ORDER BY a.id DESC`).all(customer.id);const orders=db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC').all(customer.id);const consultations=db.prepare('SELECT * FROM consultations WHERE customer_id=? ORDER BY id DESC').all(customer.id);res.render('admin/customer-detail',{title:customer.name,customer,appointments,orders,consultations});});
app.post('/admin/customers',(req,res)=>{const customer=findOrCreateCustomer(req.body,null);audit(req.user.id,'create_customer','customer',customer.id);res.redirect(`/admin/customers/${customer.id}?success=Customer record saved.`);});
app.post('/admin/customers/merge',(req,res)=>{if(req.user.role!=='admin')return res.redirect('/admin/customers?error=Only the super admin can merge records.');const keep=Number(req.body.keep_id),remove=Number(req.body.remove_id);if(!keep||!remove||keep===remove)return res.redirect('/admin/customers?error=Choose two different records.');db.exec('BEGIN');try{for(const table of ['appointments','orders','payments','consultations','bridal_bookings','notifications'])db.prepare(`UPDATE ${table} SET customer_id=? WHERE customer_id=?`).run(keep,remove);db.prepare('DELETE FROM customers WHERE id=?').run(remove);db.exec('COMMIT');audit(req.user.id,'merge_customers','customer',keep,`Removed ${remove}`);}catch(e){db.exec('ROLLBACK');return res.redirect('/admin/customers?error=Records could not be merged.');}res.redirect(`/admin/customers/${keep}?success=Duplicate records merged.`);});
app.get('/admin/appointments',(req,res)=>{const scope=branchScope(req.user),status=String(req.query.status||''),date=String(req.query.date||'');let sql=`SELECT a.*,c.name customer_name,c.phone customer_phone,b.name branch_name,u.name staff_name,GROUP_CONCAT(sv.name, ', ') services FROM appointments a JOIN customers c ON c.id=a.customer_id JOIN branches b ON b.id=a.branch_id LEFT JOIN staff st ON st.id=a.staff_id LEFT JOIN users u ON u.id=st.user_id LEFT JOIN appointment_services aps ON aps.appointment_id=a.id LEFT JOIN services sv ON sv.id=aps.service_id WHERE 1=1`;const args=[];if(scope){sql+=' AND a.branch_id=?';args.push(scope);}if(status){sql+=' AND a.status=?';args.push(status);}if(date){sql+=' AND a.appointment_date=?';args.push(date);}sql+=' GROUP BY a.id ORDER BY a.appointment_date DESC,a.start_time';const branches=db.prepare(`SELECT * FROM branches WHERE active=1 ${scope?'AND id=?':''}`).all(...(scope?[scope]:[]));const staff=db.prepare(`SELECT s.id,s.branch_id,u.name FROM staff s JOIN users u ON u.id=s.user_id WHERE s.active=1 ${scope?'AND s.branch_id=?':''}`).all(...(scope?[scope]:[]));const services=db.prepare('SELECT * FROM services WHERE active=1 ORDER BY name').all();res.render('admin/appointments',{title:'Appointment Management',appointments:db.prepare(sql).all(...args),branches,staff,services,filters:{status,date}});});
app.post('/admin/appointments/:id/status',(req,res)=>{const appt=appointmentDetails(Number(req.params.id));if(!appt)return res.redirect('/admin/appointments?error=Appointment not found.');if(branchScope(req.user)&&appt.branch_id!==req.user.branch_id)return res.redirect('/admin/appointments?error=Not allowed.');db.prepare('UPDATE appointments SET status=? WHERE id=?').run(req.body.status,appt.id);notify({customerId:appt.customer_id,title:'Appointment status updated',message:`Booking ${appt.booking_code} is now ${req.body.status}.`});audit(req.user.id,'admin_update_appointment','appointment',appt.id,req.body.status);res.redirect('/admin/appointments?success=Status updated.');});
app.get('/admin/services',(req,res)=>res.render('admin/services',{title:'Services & Pricing',services:db.prepare(`SELECT s.*,c.name category_name FROM services s JOIN service_categories c ON c.id=s.category_id ORDER BY c.id,s.name`).all(),serviceCategories:db.prepare('SELECT * FROM service_categories ORDER BY id').all()}));
app.post('/admin/services/save',(req,res)=>{if(req.user.role==='receptionist')return res.redirect('/admin/services?error=Not allowed.');const id=Number(req.body.id||0);if(id)db.prepare('UPDATE services SET category_id=?,name=?,slug=?,description=?,price=?,duration=?,home_service=?,active=? WHERE id=?').run(Number(req.body.category_id),req.body.name,slugify(req.body.name),req.body.description,Number(req.body.price),Number(req.body.duration),req.body.home_service?1:0,req.body.active?1:0,id);else db.prepare('INSERT INTO services(category_id,name,slug,description,price,duration,home_service,active) VALUES(?,?,?,?,?,?,?,?)').run(Number(req.body.category_id),req.body.name,slugify(req.body.name),req.body.description,Number(req.body.price),Number(req.body.duration),req.body.home_service?1:0,1);audit(req.user.id,'save_service','service',id||null,req.body.name);res.redirect('/admin/services?success=Service saved.');});
app.get('/admin/staff',(req,res)=>{const scope=branchScope(req.user);const staff=db.prepare(`SELECT s.*,u.name,u.email,u.phone,b.name branch_name FROM staff s JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id ${scope?'WHERE s.branch_id=?':''} ORDER BY u.name`).all(...(scope?[scope]:[]));const leave=db.prepare(`SELECT l.*,u.name staff_name FROM staff_leave l JOIN staff s ON s.id=l.staff_id JOIN users u ON u.id=s.user_id ${scope?'WHERE s.branch_id=?':''} ORDER BY l.id DESC`).all(...(scope?[scope]:[]));res.render('admin/staff',{title:'Staff Management',staff,leave,branches:db.prepare(`SELECT * FROM branches WHERE active=1 ${scope?'AND id=?':''}`).all(...(scope?[scope]:[]))});});
app.post('/admin/staff/leave/:id',(req,res)=>{if(req.user.role==='receptionist')return res.redirect('/admin/staff?error=Not allowed.');const leave=db.prepare(`SELECT l.*,s.user_id,s.branch_id FROM staff_leave l JOIN staff s ON s.id=l.staff_id WHERE l.id=?`).get(req.params.id);if(!leave||branchScope(req.user)&&leave.branch_id!==req.user.branch_id)return res.redirect('/admin/staff?error=Leave request not found.');db.prepare('UPDATE staff_leave SET status=? WHERE id=?').run(req.body.status,leave.id);notify({userId:leave.user_id,title:'Leave request updated',message:`Your leave request was ${req.body.status}.`});audit(req.user.id,'update_leave','staff_leave',leave.id,req.body.status);res.redirect('/admin/staff?success=Leave request updated.');});
app.get('/admin/inventory',(req,res)=>{const scope=branchScope(req.user);const products=db.prepare(`SELECT p.*,b.name branch_name FROM products p LEFT JOIN branches b ON b.id=p.branch_id ${scope?'WHERE p.branch_id=?':''} ORDER BY p.stock<=p.min_stock DESC,p.name`).all(...(scope?[scope]:[]));const movements=db.prepare(`SELECT im.*,p.name product_name,b.name branch_name FROM inventory_movements im JOIN products p ON p.id=im.product_id LEFT JOIN branches b ON b.id=im.branch_id ${scope?'WHERE im.branch_id=?':''} ORDER BY im.id DESC LIMIT 50`).all(...(scope?[scope]:[]));res.render('admin/inventory',{title:'Inventory Management',products,movements,branches:db.prepare(`SELECT * FROM branches WHERE active=1 ${scope?'AND id=?':''}`).all(...(scope?[scope]:[]))});});
app.post('/admin/inventory/adjust',(req,res)=>{if(req.user.role==='receptionist')return res.redirect('/admin/inventory?error=Not allowed.');const product=db.prepare('SELECT * FROM products WHERE id=?').get(Number(req.body.product_id));const qty=Number(req.body.quantity||0);if(!product||!qty)return res.redirect('/admin/inventory?error=Select a product and quantity.');if(branchScope(req.user)&&product.branch_id!==req.user.branch_id)return res.redirect('/admin/inventory?error=Not allowed.');db.prepare('UPDATE products SET stock=MAX(0,stock+?) WHERE id=?').run(qty,product.id);db.prepare('INSERT INTO inventory_movements(product_id,branch_id,movement_type,quantity,reason,created_at) VALUES(?,?,?,?,?,?)').run(product.id,product.branch_id,req.body.movement_type||'adjustment',qty,req.body.reason||'',now());audit(req.user.id,'adjust_inventory','product',product.id,`${qty}`);res.redirect('/admin/inventory?success=Inventory updated.');});
app.get('/admin/products',(req,res)=>{const scope=branchScope(req.user);res.render('admin/products',{title:'Product Catalogue',products:db.prepare(`SELECT p.*,b.name branch_name FROM products p LEFT JOIN branches b ON b.id=p.branch_id ${scope?'WHERE p.branch_id=?':''} ORDER BY p.name`).all(...(scope?[scope]:[])),branches:db.prepare(`SELECT * FROM branches WHERE active=1 ${scope?'AND id=?':''}`).all(...(scope?[scope]:[]))});});
app.post('/admin/products/save',(req,res)=>{if(req.user.role==='receptionist')return res.redirect('/admin/products?error=Not allowed.');const id=Number(req.body.id||0),branchId=branchScope(req.user)||Number(req.body.branch_id)||1;if(id)db.prepare('UPDATE products SET branch_id=?,name=?,slug=?,category=?,brand=?,description=?,price=?,stock=?,min_stock=?,active=? WHERE id=?').run(branchId,req.body.name,slugify(req.body.name),req.body.category,req.body.brand,req.body.description,Number(req.body.price),Number(req.body.stock),Number(req.body.min_stock),req.body.active?1:0,id);else db.prepare('INSERT INTO products(branch_id,name,slug,category,brand,description,price,stock,min_stock,active) VALUES(?,?,?,?,?,?,?,?,?,1)').run(branchId,req.body.name,slugify(req.body.name),req.body.category,req.body.brand,req.body.description,Number(req.body.price),Number(req.body.stock),Number(req.body.min_stock));audit(req.user.id,'save_product','product',id||null,req.body.name);res.redirect('/admin/products?success=Product saved.');});
app.get('/admin/payments',(req,res)=>{const scope=branchScope(req.user);const payments=db.prepare(`SELECT p.*,c.name customer_name,a.booking_code,o.order_code FROM payments p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN appointments a ON a.id=p.appointment_id LEFT JOIN orders o ON o.id=p.order_id ${scope?'WHERE p.appointment_id IN (SELECT id FROM appointments WHERE branch_id=?)':''} ORDER BY p.id DESC`).all(...(scope?[scope]:[]));res.render('admin/payments',{title:'Payments & Billing',payments});});
app.get('/admin/bridal',(req,res)=>{const bridal=db.prepare(`SELECT bb.*,c.name customer_name,c.phone FROM bridal_bookings bb JOIN customers c ON c.id=bb.customer_id ORDER BY bb.event_date`).all();res.render('admin/bridal',{title:'Bridal Management',bridal});});
app.post('/admin/bridal/:id',(req,res)=>{db.prepare('UPDATE bridal_bookings SET coordinator=?,status=?,total=?,deposit=?,balance=?,notes=? WHERE id=?').run(req.body.coordinator,req.body.status,Number(req.body.total),Number(req.body.deposit),Number(req.body.balance),req.body.notes,req.params.id);audit(req.user.id,'update_bridal','bridal_booking',Number(req.params.id));res.redirect('/admin/bridal?success=Bridal booking updated.');});
app.get('/admin/memberships',(req,res)=>res.render('admin/memberships',{title:'Membership Plans',memberships:db.prepare('SELECT * FROM memberships ORDER BY price_monthly').all()}));
app.post('/admin/memberships/save',(req,res)=>{if(req.user.role!=='admin')return res.redirect('/admin/memberships?error=Only the super admin can change plans.');const id=Number(req.body.id||0);if(id)db.prepare('UPDATE memberships SET name=?,price_monthly=?,price_yearly=?,discount_percent=?,points_multiplier=?,benefits=?,active=? WHERE id=?').run(req.body.name,Number(req.body.price_monthly),Number(req.body.price_yearly),Number(req.body.discount_percent),Number(req.body.points_multiplier),req.body.benefits,req.body.active?1:0,id);else db.prepare('INSERT INTO memberships(name,price_monthly,price_yearly,discount_percent,points_multiplier,benefits,active) VALUES(?,?,?,?,?,?,1)').run(req.body.name,Number(req.body.price_monthly),Number(req.body.price_yearly),Number(req.body.discount_percent),Number(req.body.points_multiplier),req.body.benefits);res.redirect('/admin/memberships?success=Membership plan saved.');});
app.get('/admin/branches',(req,res)=>res.render('admin/branches',{title:'Branch Management',branches:db.prepare('SELECT * FROM branches ORDER BY id').all()}));
app.post('/admin/branches/save',(req,res)=>{if(req.user.role!=='admin')return res.redirect('/admin/branches?error=Only the super admin can change branches.');const id=Number(req.body.id||0);if(id)db.prepare('UPDATE branches SET name=?,city=?,address=?,phone=?,opening_time=?,closing_time=?,active=? WHERE id=?').run(req.body.name,req.body.city,req.body.address,req.body.phone,req.body.opening_time,req.body.closing_time,req.body.active?1:0,id);else db.prepare('INSERT INTO branches(name,city,address,phone,opening_time,closing_time,active) VALUES(?,?,?,?,?,?,1)').run(req.body.name,req.body.city,req.body.address,req.body.phone,req.body.opening_time,req.body.closing_time);res.redirect('/admin/branches?success=Branch saved.');});
app.get('/admin/reports',(req,res)=>{const scope=branchScope(req.user),from=req.query.from||new Date(Date.now()-30*86400000).toISOString().slice(0,10),to=req.query.to||new Date().toISOString().slice(0,10);const args=[from,to,...(scope?[scope]:[])];const revenue=db.prepare(`SELECT date(created_at) day,SUM(amount) total FROM payments WHERE date(created_at) BETWEEN ? AND ? ${scope?'AND appointment_id IN (SELECT id FROM appointments WHERE branch_id=?)':''} GROUP BY date(created_at) ORDER BY day`).all(...args);const serviceRevenue=db.prepare(`SELECT s.name,COUNT(*) bookings,SUM(aps.price) revenue FROM appointment_services aps JOIN services s ON s.id=aps.service_id JOIN appointments a ON a.id=aps.appointment_id WHERE a.appointment_date BETWEEN ? AND ? ${scope?'AND a.branch_id=?':''} GROUP BY s.id ORDER BY revenue DESC`).all(...args);const branchRevenue=db.prepare(`SELECT b.name,COALESCE(SUM(p.amount),0) revenue FROM branches b LEFT JOIN appointments a ON a.branch_id=b.id LEFT JOIN payments p ON p.appointment_id=a.id WHERE (p.created_at IS NULL OR date(p.created_at) BETWEEN ? AND ?) ${scope?'AND b.id=?':''} GROUP BY b.id ORDER BY revenue DESC`).all(...args);const expenses=db.prepare(`SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE expense_date BETWEEN ? AND ? ${scope?'AND branch_id=?':''}`).get(...args).total;const totalRevenue=revenue.reduce((a,x)=>a+x.total,0);res.render('admin/reports',{title:'Reports & Analytics',from,to,revenue,serviceRevenue,branchRevenue,expenses,totalRevenue,profit:totalRevenue-expenses});});
app.get('/admin/settings',(req,res)=>{if(req.user.role!=='admin')return res.status(403).render('public/message',{title:'Access denied',message:'Only the super admin can manage system settings.',type:'error'});const settings=Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(x=>[x.key,x.value]));res.render('admin/settings',{title:'System Settings',settings});});
app.post('/admin/settings',(req,res)=>{if(req.user.role!=='admin')return res.redirect('/admin?error=Not allowed.');for(const key of ['salon_name','currency','booking_deposit_percent'])db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key,String(req.body[key]||''));audit(req.user.id,'update_settings','settings');res.redirect('/admin/settings?success=Settings saved.');});

app.get('/health',(req,res)=>res.json({status:'ok',app:APP_NAME,time:now()}));
app.use((req,res)=>res.status(404).render('public/message',{title:'Page not found',message:'The page you requested does not exist.',type:'error'}));
app.use((err,req,res,next)=>{console.error(err);res.status(500).render('public/message',{title:'Something went wrong',message:'The request could not be completed. Please try again.',type:'error'});});

// Vercel imports the Express application as a serverless function.
// A normal listener is kept for local development and traditional Node hosting.
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`${APP_NAME} is running at http://localhost:${PORT}`);
  });
}

module.exports = app;
