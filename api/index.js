const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load seed data into memory (and /tmp for serverless persistence across warm invocations)
const SEED_PATH = path.join(__dirname, 'seedData.json');
const TMP_DB_PATH = '/tmp/jeem_store_db.json';

let db = {
  users: [],
  categories: [],
  products: [],
  banners: [],
  orders: [],
  order_items: [],
  referrals: [],
  referral_orders: [],
  gifts: [],
  gift_claims: [],
  notifications: []
};

function loadDb() {
  try {
    if (fs.existsSync(TMP_DB_PATH)) {
      db = JSON.parse(fs.readFileSync(TMP_DB_PATH, 'utf8'));
      return;
    }
  } catch (e) {
    // ignore tmp read errors
  }
  try {
    if (fs.existsSync(SEED_PATH)) {
      db = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load seedData.json:', e.message);
  }
}

function saveDb() {
  try {
    if (fs.existsSync('/tmp')) {
      fs.writeFileSync(TMP_DB_PATH, JSON.stringify(db));
    }
  } catch (e) {
    // ignore write errors in read-only environments
  }
}

loadDb();

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatProduct(row) {
  if (!row) return null;
  const cat = db.categories.find((c) => c.id === row.category_id);
  return {
    ...row,
    category_name: row.category_name || (cat ? cat.name : ''),
    category_slug: row.category_slug || (cat ? cat.slug : ''),
    sizes: typeof row.sizes === 'string' ? JSON.parse(row.sizes) : (row.sizes || []),
    colors: typeof row.colors === 'string' ? JSON.parse(row.colors) : (row.colors || []),
    specifications: typeof row.specifications === 'string' ? JSON.parse(row.specifications) : (row.specifications || []),
    images: typeof row.images === 'string' ? JSON.parse(row.images) : (row.images || [])
  };
}

// Helper: check referral milestones
function checkReferralMilestones(referrerUserId) {
  const refOrders = db.referral_orders.filter((ro) => ro.referrer_user_id === referrerUserId);
  const confirmedCount = refOrders.filter((ro) => Number(ro.is_confirmed) === 1).length;
  const deliveredPaidCount = refOrders.filter((ro) => Number(ro.is_delivered_and_paid) === 1).length;

  if (confirmedCount >= 4) {
    const already = db.notifications.find(
      (n) => n.user_id === referrerUserId && n.title && n.title.includes('آپ کے ریفرنس سے 4 آرڈر ہوئے ہیں')
    );
    if (!already) {
      db.notifications.unshift({
        id: `notif_${crypto.randomBytes(4).toString('hex')}`,
        user_id: referrerUserId,
        title: '🎉 مبارک ہو! آپ کے ریفرنس سے 4 آرڈر ہوئے ہیں',
        message: 'جیسے ہی یہ آرڈر کسٹمر وصول کرکے پیمنٹ کرے گا، آپ کو آپ کی پسند کا گفٹ دیا جائے گا۔',
        type: 'referral',
        is_read: 0,
        link: '/share-and-earn',
        created_at: nowIso()
      });
    }
  }

  if (deliveredPaidCount >= 4) {
    const already = db.notifications.find(
      (n) => n.user_id === referrerUserId && n.title && n.title.includes('Gift Unlocked')
    );
    if (!already) {
      db.notifications.unshift({
        id: `notif_${crypto.randomBytes(4).toString('hex')}`,
        user_id: referrerUserId,
        title: '🎁 Gift Unlocked! آپ کا گفٹ ان لاک ہو چکا ہے',
        message: 'مبارک ہو! آپ کے Referral کے 4 آرڈر کامیابی سے وصول اور Paid ہو چکے ہیں۔ اب اپنی پسند کا Gift منتخب کریں۔',
        type: 'gift',
        is_read: 0,
        link: '/share-and-earn',
        created_at: nowIso()
      });
    }
  }
}

// ==========================================
// 1. HEALTH & ROOT
// ==========================================
app.get(['/api', '/api/'], (req, res) => {
  res.json({
    status: 'ok',
    store: 'JEEM',
    slogan: 'اسلامی تجارت کے اصولوں کے مطابق',
    timestamp: new Date().toISOString()
  });
});

app.get(['/api/health', '/health'], (req, res) => {
  res.json({
    status: 'ok',
    store: 'JEEM',
    slogan: 'اسلامی تجارت کے اصولوں کے مطابق',
    timestamp: new Date().toISOString()
  });
});

// ==========================================
// 2. AUTH ROUTES
// ==========================================
app.post('/api/auth/admin-login', (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) {
    return res.status(400).json({ success: false, error: 'Phone and password are required' });
  }
  const admin = db.users.find(
    (u) => (u.phone === phone || u.email === phone) && u.role === 'admin'
  );
  if (!admin || admin.password !== password) {
    return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
  }
  res.json({
    success: true,
    data: {
      id: admin.id,
      name: admin.name,
      phone: admin.phone,
      email: admin.email,
      role: admin.role,
      token: `adm_${crypto.randomBytes(16).toString('hex')}`
    }
  });
});

app.post('/api/auth/customer-session', (req, res) => {
  const { phone, name, whatsapp, referral_code } = req.body || {};
  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number is required' });
  }
  let user = db.users.find((u) => u.phone === phone);
  if (!user) {
    const id = `usr_${crypto.randomBytes(4).toString('hex')}`;
    const newRefCode = `JM-${phone.slice(-4)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    user = {
      id,
      name: name || 'Customer',
      phone,
      whatsapp: whatsapp || phone,
      email: null,
      password: null,
      role: 'customer',
      referral_code: newRefCode,
      referred_by: referral_code || null,
      created_at: nowIso()
    };
    db.users.push(user);

    if (referral_code) {
      const referrer = db.users.find((u) => u.referral_code === referral_code);
      if (referrer && referrer.id !== id) {
        const exists = db.referrals.find(
          (r) => r.referrer_user_id === referrer.id && r.referred_user_id === id
        );
        if (!exists) {
          db.referrals.push({
            id: `ref_${crypto.randomBytes(4).toString('hex')}`,
            referrer_user_id: referrer.id,
            referred_user_id: id,
            status: 'active',
            ip_address: '',
            created_at: nowIso()
          });
        }
      }
    }
    saveDb();
  } else if (name && user.name === 'Customer') {
    user.name = name;
    saveDb();
  }

  res.json({
    success: true,
    data: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      whatsapp: user.whatsapp,
      email: user.email,
      role: user.role,
      referral_code: user.referral_code
    }
  });
});

app.get('/api/auth/user/:userId', (req, res) => {
  const user = db.users.find((u) => u.id === req.params.userId);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, data: user });
});

// ==========================================
// 3. CATEGORIES ROUTES
// ==========================================
app.get('/api/categories', (req, res) => {
  const active = db.categories
    .filter((c) => Number(c.is_active) === 1)
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  res.json({ success: true, data: active });
});

app.get('/api/categories/all', (req, res) => {
  const all = [...db.categories].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  res.json({ success: true, data: all });
});

app.post('/api/categories', (req, res) => {
  const { name, name_ur, slug, image_url, sort_order, is_active } = req.body || {};
  if (!name || !image_url) {
    return res.status(400).json({ success: false, error: 'Name and image URL are required' });
  }
  const id = `cat_${crypto.randomBytes(4).toString('hex')}`;
  const generatedSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const created = {
    id,
    name,
    name_ur: name_ur || name,
    slug: generatedSlug,
    image_url,
    sort_order: sort_order ? Number(sort_order) : 0,
    is_active: is_active !== undefined ? Number(is_active) : 1,
    created_at: nowIso()
  };
  db.categories.push(created);
  saveDb();
  res.json({ success: true, data: created });
});

app.put('/api/categories/:id', (req, res) => {
  const cat = db.categories.find((c) => c.id === req.params.id);
  if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });
  const { name, name_ur, slug, image_url, sort_order, is_active } = req.body || {};
  if (name !== undefined) cat.name = name;
  if (name_ur !== undefined) cat.name_ur = name_ur;
  if (slug !== undefined) cat.slug = slug;
  if (image_url !== undefined) cat.image_url = image_url;
  if (sort_order !== undefined) cat.sort_order = Number(sort_order);
  if (is_active !== undefined) cat.is_active = Number(is_active);
  saveDb();
  res.json({ success: true, data: cat });
});

app.delete('/api/categories/:id', (req, res) => {
  const count = db.products.filter((p) => p.category_id === req.params.id).length;
  if (count > 0) {
    return res.status(400).json({
      success: false,
      error: `Cannot delete category: ${count} product(s) are assigned to it.`
    });
  }
  db.categories = db.categories.filter((c) => c.id !== req.params.id);
  saveDb();
  res.json({ success: true, message: 'Category deleted successfully' });
});

// ==========================================
// 4. BANNERS ROUTES
// ==========================================
app.get('/api/banners', (req, res) => {
  const active = db.banners
    .filter((b) => Number(b.is_active) === 1)
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  res.json({ success: true, data: active });
});

app.get('/api/banners/all', (req, res) => {
  const all = [...db.banners].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  res.json({ success: true, data: all });
});

app.post('/api/banners', (req, res) => {
  const { title, title_ur, subtitle, button_text, link_type, link_target, image_url, sort_order, start_date, end_date, is_active } = req.body || {};
  if (!title || !image_url) {
    return res.status(400).json({ success: false, error: 'Title and image URL are required' });
  }
  const created = {
    id: `bnr_${crypto.randomBytes(4).toString('hex')}`,
    title,
    title_ur: title_ur || title,
    subtitle: subtitle || '',
    button_text: button_text || 'Shop Now',
    link_type: link_type || 'category',
    link_target: link_target || '',
    image_url,
    sort_order: sort_order ? Number(sort_order) : 0,
    start_date: start_date || null,
    end_date: end_date || null,
    is_active: is_active !== undefined ? Number(is_active) : 1,
    created_at: nowIso()
  };
  db.banners.push(created);
  saveDb();
  res.json({ success: true, data: created });
});

app.put('/api/banners/:id', (req, res) => {
  const b = db.banners.find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ success: false, error: 'Banner not found' });
  const { title, title_ur, subtitle, button_text, link_type, link_target, image_url, sort_order, start_date, end_date, is_active } = req.body || {};
  if (title !== undefined) b.title = title;
  if (title_ur !== undefined) b.title_ur = title_ur;
  if (subtitle !== undefined) b.subtitle = subtitle;
  if (button_text !== undefined) b.button_text = button_text;
  if (link_type !== undefined) b.link_type = link_type;
  if (link_target !== undefined) b.link_target = link_target;
  if (image_url !== undefined) b.image_url = image_url;
  if (sort_order !== undefined) b.sort_order = Number(sort_order);
  if (start_date !== undefined) b.start_date = start_date;
  if (end_date !== undefined) b.end_date = end_date;
  if (is_active !== undefined) b.is_active = Number(is_active);
  saveDb();
  res.json({ success: true, data: b });
});

app.delete('/api/banners/:id', (req, res) => {
  db.banners = db.banners.filter((b) => b.id !== req.params.id);
  saveDb();
  res.json({ success: true, message: 'Banner deleted successfully' });
});

// ==========================================
// 5. PRODUCTS ROUTES
// ==========================================
app.get('/api/products', (req, res) => {
  const { category, search, featured, new_arrival, best_seller, min_price, max_price, in_stock, sort, limit } = req.query;
  let list = db.products.filter((p) => Number(p.is_active) === 1).map(formatProduct);

  if (category) {
    list = list.filter((p) => p.category_slug === category || p.category_id === category);
  }
  if (search) {
    const q = String(search).trim().toLowerCase();
    list = list.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.name_ur && p.name_ur.includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.category_name && p.category_name.toLowerCase().includes(q))
    );
  }
  if (featured === '1' || featured === 'true') list = list.filter((p) => Number(p.is_featured) === 1);
  if (new_arrival === '1' || new_arrival === 'true') list = list.filter((p) => Number(p.is_new_arrival) === 1);
  if (best_seller === '1' || best_seller === 'true') list = list.filter((p) => Number(p.is_best_seller) === 1);
  if (in_stock === '1' || in_stock === 'true') list = list.filter((p) => Number(p.stock) > 0);
  if (min_price) list = list.filter((p) => (p.sale_price ?? p.price) >= Number(min_price));
  if (max_price) list = list.filter((p) => (p.sale_price ?? p.price) <= Number(max_price));

  if (sort === 'price_asc') {
    list.sort((a, b) => (a.sale_price ?? a.price) - (b.sale_price ?? b.price));
  } else if (sort === 'price_desc') {
    list.sort((a, b) => (b.sale_price ?? b.price) - (a.sale_price ?? a.price));
  }

  if (limit) list = list.slice(0, Number(limit));

  res.json({ success: true, count: list.length, data: list });
});

app.get('/api/products/all', (req, res) => {
  const list = db.products.map(formatProduct);
  res.json({ success: true, count: list.length, data: list });
});

app.get('/api/products/:slugOrId', (req, res) => {
  const { slugOrId } = req.params;
  const p = db.products.find((x) => x.slug === slugOrId || x.id === slugOrId);
  if (!p) return res.status(404).json({ success: false, error: 'Product not found' });
  res.json({ success: true, data: formatProduct(p) });
});

app.post('/api/products', (req, res) => {
  const { name, name_ur, category_id, sku, brand, price, sale_price, stock, sizes, colors, description, specifications, is_featured, is_new_arrival, is_best_seller, is_active, images } = req.body || {};
  if (!name || !category_id || !price) {
    return res.status(400).json({ success: false, error: 'Name, category, and price are required' });
  }
  const id = `prod_${crypto.randomBytes(4).toString('hex')}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + crypto.randomBytes(2).toString('hex');
  const created = {
    id,
    vendor_id: null,
    name,
    name_ur: name_ur || name,
    slug,
    category_id,
    sku: sku || `JM-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    brand: brand || 'JEEM',
    price: Number(price),
    sale_price: sale_price ? Number(sale_price) : null,
    stock: stock ? Number(stock) : 0,
    sizes: JSON.stringify(sizes || ['Standard']),
    colors: JSON.stringify(colors || []),
    description: description || '',
    specifications: JSON.stringify(specifications || []),
    is_featured: is_featured ? 1 : 0,
    is_new_arrival: is_new_arrival ? 1 : 0,
    is_best_seller: is_best_seller ? 1 : 0,
    is_active: is_active !== undefined ? Number(is_active) : 1,
    images: JSON.stringify(images || []),
    created_at: nowIso()
  };
  db.products.unshift(created);
  saveDb();
  res.json({ success: true, data: formatProduct(created) });
});

app.put('/api/products/:id', (req, res) => {
  const p = db.products.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, error: 'Product not found' });
  const { name, name_ur, category_id, sku, brand, price, sale_price, stock, sizes, colors, description, specifications, is_featured, is_new_arrival, is_best_seller, is_active, images } = req.body || {};
  if (name !== undefined) p.name = name;
  if (name_ur !== undefined) p.name_ur = name_ur;
  if (category_id !== undefined) p.category_id = category_id;
  if (sku !== undefined) p.sku = sku;
  if (brand !== undefined) p.brand = brand;
  if (price !== undefined) p.price = Number(price);
  if (sale_price !== undefined) p.sale_price = sale_price ? Number(sale_price) : null;
  if (stock !== undefined) p.stock = Number(stock);
  if (sizes !== undefined) p.sizes = JSON.stringify(sizes);
  if (colors !== undefined) p.colors = JSON.stringify(colors);
  if (description !== undefined) p.description = description;
  if (specifications !== undefined) p.specifications = JSON.stringify(specifications);
  if (is_featured !== undefined) p.is_featured = Number(is_featured);
  if (is_new_arrival !== undefined) p.is_new_arrival = Number(is_new_arrival);
  if (is_best_seller !== undefined) p.is_best_seller = Number(is_best_seller);
  if (is_active !== undefined) p.is_active = Number(is_active);
  if (images !== undefined) p.images = JSON.stringify(images);
  saveDb();
  res.json({ success: true, data: formatProduct(p) });
});

app.delete('/api/products/:id', (req, res) => {
  db.products = db.products.filter((p) => p.id !== req.params.id);
  saveDb();
  res.json({ success: true, message: 'Product deleted successfully' });
});

// ==========================================
// 6. ORDERS ROUTES
// ==========================================
app.post('/api/orders', (req, res) => {
  const { customer_name, customer_phone, customer_whatsapp, province, city, area, address, postal_code, allow_to_open, items, referral_code, notes } = req.body || {};
  if (!customer_name || !customer_phone || !address || !items || !items.length) {
    return res.status(400).json({ success: false, error: 'Missing required order fields or items' });
  }

  const orderId = `ord_${crypto.randomBytes(4).toString('hex')}`;
  const orderNumber = `JM-2026-${Math.floor(1000 + Math.random() * 9000)}`;

  let subtotal = 0;
  for (const item of items) {
    subtotal += Number(item.price) * Number(item.quantity);
  }
  const deliveryFee = subtotal >= 5000 ? 0 : 200;
  const total = subtotal + deliveryFee;

  let customer = db.users.find((u) => u.phone === customer_phone);
  let customerId = customer ? customer.id : null;

  if (!customer) {
    customerId = `usr_${crypto.randomBytes(4).toString('hex')}`;
    const newRefCode = `JM-${customer_phone.slice(-4)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    customer = {
      id: customerId,
      name: customer_name,
      phone: customer_phone,
      whatsapp: customer_whatsapp || customer_phone,
      email: null,
      password: null,
      role: 'customer',
      referral_code: newRefCode,
      referred_by: referral_code || null,
      created_at: nowIso()
    };
    db.users.push(customer);
  }

  const newOrder = {
    id: orderId,
    order_number: orderNumber,
    customer_id: customerId,
    customer_name,
    customer_phone,
    customer_whatsapp: customer_whatsapp || customer_phone,
    province: province || 'Punjab',
    city: city || 'Lahore',
    area: area || '',
    address,
    postal_code: postal_code || '',
    allow_to_open: allow_to_open !== undefined ? Number(allow_to_open) : 1,
    payment_method: 'cod',
    status: 'new',
    payment_status: 'pending',
    subtotal,
    delivery_fee: deliveryFee,
    total,
    referral_code: referral_code || null,
    notes: notes || '',
    created_at: nowIso(),
    updated_at: nowIso()
  };
  db.orders.unshift(newOrder);

  for (const item of items) {
    db.order_items.push({
      id: `item_${crypto.randomBytes(4).toString('hex')}`,
      order_id: orderId,
      product_id: item.product_id,
      product_name: item.product_name,
      product_image: item.product_image || '',
      size: item.size || 'Standard',
      color: item.color || 'Default',
      quantity: Number(item.quantity),
      price: Number(item.price),
      total: Number(item.price) * Number(item.quantity)
    });
    const prod = db.products.find((p) => p.id === item.product_id);
    if (prod) prod.stock = Math.max(0, Number(prod.stock) - Number(item.quantity));
  }

  if (referral_code) {
    const referrer = db.users.find((u) => u.referral_code === referral_code);
    if (referrer && referrer.id !== customerId) {
      const refExists = db.referrals.find(
        (r) => r.referrer_user_id === referrer.id && r.referred_user_id === customerId
      );
      if (!refExists) {
        db.referrals.push({
          id: `ref_${crypto.randomBytes(4).toString('hex')}`,
          referrer_user_id: referrer.id,
          referred_user_id: customerId,
          status: 'active',
          ip_address: '',
          created_at: nowIso()
        });
      }
      db.referral_orders.push({
        id: `reford_${crypto.randomBytes(4).toString('hex')}`,
        referrer_user_id: referrer.id,
        order_id: orderId,
        order_status: 'new',
        payment_status: 'pending',
        is_confirmed: 0,
        is_delivered_and_paid: 0,
        created_at: nowIso()
      });
    }
  }

  if (customerId) {
    db.notifications.unshift({
      id: `notif_${crypto.randomBytes(4).toString('hex')}`,
      user_id: customerId,
      title: `آرڈر موصول ہو گیا (#${orderNumber})`,
      message: `آپ کا آرڈر نمبر ${orderNumber} موصول ہو چکا ہے۔ پارسل کھول کر چیک کرنے کی سہولت (Allow to Open) لاگو ہوگی۔`,
      type: 'order',
      is_read: 0,
      link: `/order-tracking?order=${orderNumber}`,
      created_at: nowIso()
    });
  }

  saveDb();
  res.json({
    success: true,
    message: 'Order placed successfully',
    data: {
      order_id: orderId,
      order_number: orderNumber,
      total,
      delivery_fee: deliveryFee,
      allow_to_open: newOrder.allow_to_open
    }
  });
});

app.get('/api/orders/:orderNumberOrId', (req, res) => {
  const { orderNumberOrId } = req.params;
  const order = db.orders.find((o) => o.order_number === orderNumberOrId || o.id === orderNumberOrId);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  const items = db.order_items.filter((i) => i.order_id === order.id);
  res.json({ success: true, data: { ...order, items } });
});

app.get('/api/orders', (req, res) => {
  const { phone, user_id, status, search, limit } = req.query;
  let list = [...db.orders];

  if (phone) list = list.filter((o) => o.customer_phone === phone);
  if (user_id) list = list.filter((o) => o.customer_id === user_id);
  if (status && status !== 'all') list = list.filter((o) => o.status === status);
  if (search) {
    const q = String(search).trim().toLowerCase();
    list = list.filter(
      (o) =>
        (o.order_number && o.order_number.toLowerCase().includes(q)) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(q)) ||
        (o.customer_phone && o.customer_phone.includes(q))
    );
  }
  if (limit) list = list.slice(0, Number(limit));

  const enriched = list.map((o) => ({
    ...o,
    items: db.order_items.filter((i) => i.order_id === o.id)
  }));

  res.json({ success: true, count: enriched.length, data: enriched });
});

app.patch('/api/orders/:id/status', (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

  const { status, payment_status } = req.body || {};
  const newStatus = status || order.status;
  let newPaymentStatus = payment_status || order.payment_status;
  if (newStatus === 'delivered' && !payment_status) {
    newPaymentStatus = 'paid';
  }

  order.status = newStatus;
  order.payment_status = newPaymentStatus;
  order.updated_at = nowIso();

  const refRec = db.referral_orders.find((ro) => ro.order_id === order.id);
  if (refRec) {
    refRec.order_status = newStatus;
    refRec.payment_status = newPaymentStatus;
    refRec.is_confirmed = ['confirmed', 'processing', 'shipped', 'delivered'].includes(newStatus) ? 1 : 0;
    refRec.is_delivered_and_paid = newStatus === 'delivered' && newPaymentStatus === 'paid' ? 1 : 0;
    checkReferralMilestones(refRec.referrer_user_id);
  }

  if (order.customer_id) {
    let urduMessage = '';
    if (newStatus === 'confirmed') urduMessage = 'آپ کا آرڈر کنفرم ہو چکا ہے اور پیکنگ کا عمل جاری ہے۔';
    else if (newStatus === 'shipped') urduMessage = 'آپ کا پارسل روانہ (Shipped) کر دیا گیا ہے۔ پارسل کھولنے کی اجازت ہے۔';
    else if (newStatus === 'delivered') urduMessage = 'آپ کا پارسل بحفاظت پہنچا دیا گیا ہے۔ خریداری کا شکریہ!';

    if (urduMessage) {
      db.notifications.unshift({
        id: `notif_${crypto.randomBytes(4).toString('hex')}`,
        user_id: order.customer_id,
        title: `آرڈر اپڈیٹ: ${newStatus.toUpperCase()}`,
        message: urduMessage,
        type: 'order',
        is_read: 0,
        link: `/order-tracking?order=${order.order_number}`,
        created_at: nowIso()
      });
    }
  }

  saveDb();
  res.json({ success: true, data: order });
});

// ==========================================
// 7. REFERRALS ROUTES
// ==========================================
app.get('/api/referrals/stats', (req, res) => {
  const { user_id, referral_code } = req.query;
  let user = null;
  if (user_id) user = db.users.find((u) => u.id === user_id);
  else if (referral_code) user = db.users.find((u) => u.referral_code === referral_code);
  else user = db.users.find((u) => u.role === 'customer');

  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const totalReferrals = db.referrals.filter((r) => r.referrer_user_id === user.id && r.status === 'active').length;
  const isStage1Complete = totalReferrals >= 10;

  const refOrders = db.referral_orders.filter((ro) => ro.referrer_user_id === user.id);
  const totalReferralOrders = refOrders.length;
  const confirmedOrders = refOrders.filter((ro) => Number(ro.is_confirmed) === 1).length;
  const isStage2Complete = isStage1Complete && confirmedOrders >= 4;

  const deliveredPaidOrders = refOrders.filter((ro) => Number(ro.is_delivered_and_paid) === 1).length;
  const isGiftUnlocked = isStage2Complete && deliveredPaidOrders >= 4;

  const claim = db.gift_claims.find((gc) => gc.user_id === user.id);
  let claimedGift = null;
  if (claim) {
    const g = db.gifts.find((x) => x.id === claim.gift_id);
    claimedGift = {
      ...claim,
      gift_name: g ? g.name : '',
      gift_image: g ? g.image_url : ''
    };
  }

  const formattedOrders = refOrders.map((ro) => {
    const o = db.orders.find((x) => x.id === ro.order_id) || {};
    return {
      ...ro,
      order_number: o.order_number || '',
      total: o.total || 0,
      customer_name: o.customer_name ? `${o.customer_name.slice(0, 3)}***` : 'Customer'
    };
  });

  res.json({
    success: true,
    data: {
      user_id: user.id,
      user_name: user.name,
      referral_code: user.referral_code,
      total_referrals: totalReferrals,
      target_referrals: 10,
      is_stage_1_complete: isStage1Complete,
      total_referral_orders: totalReferralOrders,
      confirmed_orders: confirmedOrders,
      target_confirmed_orders: 4,
      is_stage_2_complete: isStage2Complete,
      delivered_paid_orders: deliveredPaidOrders,
      target_delivered_paid: 4,
      is_gift_unlocked: isGiftUnlocked,
      has_claimed_gift: Boolean(claimedGift),
      claimed_gift: claimedGift,
      recent_orders: formattedOrders
    }
  });
});

app.post('/api/referrals/register', (req, res) => {
  const { name, phone, referral_code } = req.body || {};
  if (!name || !phone || !referral_code) {
    return res.status(400).json({ success: false, error: 'Name, phone, and referral code are required' });
  }
  const referrer = db.users.find((u) => u.referral_code === referral_code);
  if (!referrer) return res.status(404).json({ success: false, error: 'Invalid referral code' });
  if (referrer.phone === phone) return res.status(400).json({ success: false, error: 'Self-referral is not allowed' });

  let user = db.users.find((u) => u.phone === phone);
  if (user && user.referred_by) {
    return res.status(400).json({ success: false, error: 'This customer has already been referred' });
  }

  const userId = user ? user.id : `usr_${crypto.randomBytes(4).toString('hex')}`;
  const newRefCode = `JM-${phone.slice(-4)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  if (!user) {
    user = {
      id: userId,
      name,
      phone,
      whatsapp: phone,
      email: null,
      password: null,
      role: 'customer',
      referral_code: newRefCode,
      referred_by: referral_code,
      created_at: nowIso()
    };
    db.users.push(user);
  } else {
    user.referred_by = referral_code;
  }

  const exists = db.referrals.find((r) => r.referrer_user_id === referrer.id && r.referred_user_id === userId);
  if (!exists) {
    db.referrals.push({
      id: `ref_${crypto.randomBytes(4).toString('hex')}`,
      referrer_user_id: referrer.id,
      referred_user_id: userId,
      status: 'active',
      ip_address: '',
      created_at: nowIso()
    });
  }

  saveDb();
  res.json({
    success: true,
    message: 'Referral registered successfully',
    data: { user_id: userId, referral_code: newRefCode }
  });
});

app.get('/api/referrals/admin-overview', (req, res) => {
  const customers = db.users.filter((u) => u.role === 'customer');
  const overview = [];
  for (const u of customers) {
    const refs = db.referrals.filter((r) => r.referrer_user_id === u.id);
    const refOrders = db.referral_orders.filter((ro) => ro.referrer_user_id === u.id);
    if (refs.length > 0 || refOrders.length > 0) {
      const claim = db.gift_claims.find((gc) => gc.user_id === u.id);
      const gift = claim ? db.gifts.find((g) => g.id === claim.gift_id) : null;
      overview.push({
        id: u.id,
        referrer_name: u.name,
        referrer_phone: u.phone,
        referral_code: u.referral_code,
        created_at: u.created_at,
        total_referrals: refs.length,
        total_orders: refOrders.length,
        confirmed_orders: refOrders.filter((ro) => Number(ro.is_confirmed) === 1).length,
        delivered_paid_orders: refOrders.filter((ro) => Number(ro.is_delivered_and_paid) === 1).length,
        gift_claim_id: claim ? claim.id : null,
        gift_claim_status: claim ? claim.status : null,
        gift_name: gift ? gift.name : null
      });
    }
  }
  res.json({ success: true, data: overview });
});

// ==========================================
// 8. GIFTS ROUTES
// ==========================================
app.get('/api/gifts', (req, res) => {
  const active = db.gifts.filter((g) => Number(g.is_active) === 1 && Number(g.stock) > 0);
  res.json({ success: true, data: active });
});

app.get('/api/gifts/all', (req, res) => {
  res.json({ success: true, data: db.gifts });
});

app.post('/api/gifts', (req, res) => {
  const { name, name_ur, description, image_url, stock, is_active } = req.body || {};
  if (!name || !image_url) return res.status(400).json({ success: false, error: 'Name and image URL are required' });
  const created = {
    id: `gift_${crypto.randomBytes(4).toString('hex')}`,
    name,
    name_ur: name_ur || name,
    description: description || '',
    image_url,
    stock: stock ? Number(stock) : 10,
    is_active: is_active !== undefined ? Number(is_active) : 1,
    created_at: nowIso()
  };
  db.gifts.push(created);
  saveDb();
  res.json({ success: true, data: created });
});

app.get('/api/gifts/claims', (req, res) => {
  const claims = db.gift_claims.map((gc) => {
    const g = db.gifts.find((x) => x.id === gc.gift_id) || {};
    const u = db.users.find((x) => x.id === gc.user_id) || {};
    return {
      ...gc,
      gift_name: g.name || '',
      gift_image: g.image_url || '',
      user_phone: u.phone || ''
    };
  });
  res.json({ success: true, data: claims });
});

app.post('/api/gifts/claim', (req, res) => {
  const { user_id, gift_id, customer_name, customer_phone, shipping_address } = req.body || {};
  if (!user_id || !gift_id || !customer_name || !customer_phone || !shipping_address) {
    return res.status(400).json({ success: false, error: 'All fields are required to claim your gift' });
  }
  const existing = db.gift_claims.find((gc) => gc.user_id === user_id);
  if (existing) {
    return res.status(400).json({ success: false, error: 'You have already claimed your reward gift.' });
  }
  const gift = db.gifts.find((g) => g.id === gift_id);
  if (!gift || gift.stock < 1) {
    return res.status(400).json({ success: false, error: 'Selected gift is out of stock.' });
  }
  const claimId = `claim_${crypto.randomBytes(4).toString('hex')}`;
  db.gift_claims.push({
    id: claimId,
    user_id,
    gift_id,
    status: 'pending',
    customer_name,
    customer_phone,
    shipping_address,
    tracking_notes: null,
    created_at: nowIso(),
    updated_at: nowIso()
  });
  gift.stock -= 1;
  saveDb();
  res.json({ success: true, message: 'Gift claim submitted successfully!', data: { claim_id: claimId, gift_name: gift.name } });
});

app.patch('/api/gifts/claims/:id/status', (req, res) => {
  const claim = db.gift_claims.find((gc) => gc.id === req.params.id);
  if (!claim) return res.status(404).json({ success: false, error: 'Gift claim not found' });
  const { status, tracking_notes } = req.body || {};
  if (status) claim.status = status;
  if (tracking_notes !== undefined) claim.tracking_notes = tracking_notes;
  claim.updated_at = nowIso();
  saveDb();
  res.json({ success: true, data: claim });
});

app.put('/api/gifts/:id', (req, res) => {
  const g = db.gifts.find((x) => x.id === req.params.id);
  if (!g) return res.status(404).json({ success: false, error: 'Gift not found' });
  const { name, name_ur, description, image_url, stock, is_active } = req.body || {};
  if (name !== undefined) g.name = name;
  if (name_ur !== undefined) g.name_ur = name_ur;
  if (description !== undefined) g.description = description;
  if (image_url !== undefined) g.image_url = image_url;
  if (stock !== undefined) g.stock = Number(stock);
  if (is_active !== undefined) g.is_active = Number(is_active);
  saveDb();
  res.json({ success: true, data: g });
});

app.delete('/api/gifts/:id', (req, res) => {
  db.gifts = db.gifts.filter((g) => g.id !== req.params.id);
  saveDb();
  res.json({ success: true, message: 'Gift deleted successfully' });
});

// ==========================================
// 9. NOTIFICATIONS ROUTES
// ==========================================
app.get('/api/notifications', (req, res) => {
  let targetUserId = req.query.user_id;
  if (!targetUserId) {
    const demo = db.users.find((u) => u.role === 'customer');
    targetUserId = demo ? demo.id : null;
  }
  if (!targetUserId) return res.json({ success: true, data: [] });
  const list = db.notifications.filter((n) => n.user_id === targetUserId).slice(0, 50);
  res.json({ success: true, data: list });
});

app.patch('/api/notifications/:id/read', (req, res) => {
  const n = db.notifications.find((x) => x.id === req.params.id);
  if (n) n.is_read = 1;
  saveDb();
  res.json({ success: true, message: 'Notification marked as read' });
});

app.post('/api/notifications/read-all', (req, res) => {
  const { user_id } = req.body || {};
  if (user_id) {
    db.notifications.forEach((n) => {
      if (n.user_id === user_id) n.is_read = 1;
    });
    saveDb();
  }
  res.json({ success: true, message: 'All notifications marked as read' });
});

// ==========================================
// 10. ADMIN DASHBOARD STATS
// ==========================================
app.get('/api/admin/dashboard-stats', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const validOrders = db.orders.filter((o) => !['cancelled', 'returned'].includes(o.status));
  const totalSales = validOrders
    .filter((o) => o.payment_status === 'paid' || o.status === 'delivered')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const grossSales = validOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const todayOrdersList = db.orders.filter((o) => o.created_at && o.created_at.startsWith(today));
  const todaySales = todayOrdersList.reduce((sum, o) => sum + Number(o.total || 0), 0);

  const countStatus = (st) => db.orders.filter((o) => o.status === st).length;
  const lowStock = db.products.filter((p) => Number(p.stock) <= 10).map(formatProduct);

  res.json({
    success: true,
    data: {
      total_products: db.products.length,
      total_customers: db.users.filter((u) => u.role === 'customer').length,
      total_orders: db.orders.length,
      today_orders: todayOrdersList.length,
      today_sales: todaySales,
      total_sales: totalSales,
      gross_sales: grossSales,
      new_orders: countStatus('new'),
      confirmed_orders: countStatus('confirmed'),
      processing_orders: countStatus('processing'),
      shipped_orders: countStatus('shipped'),
      delivered_orders: countStatus('delivered'),
      cancelled_orders: countStatus('cancelled'),
      returned_orders: countStatus('returned'),
      pending_orders: countStatus('new') + countStatus('confirmed') + countStatus('processing'),
      low_stock_count: lowStock.length,
      low_stock_products: lowStock,
      total_referrals: db.referrals.length,
      total_referral_orders: db.referral_orders.length,
      pending_gift_claims: db.gift_claims.filter((gc) => gc.status === 'pending').length,
      recent_orders: db.orders.slice(0, 6)
    }
  });
});

// Vercel Serverless Function entry point with subpath reconstruction
module.exports = function handler(req, res) {
  let subpath = null;
  const parsedUrl = new URL(req.url || '/api', 'http://localhost');

  if (req.query && req.query.__subpath) {
    subpath = req.query.__subpath;
    delete req.query.__subpath;
  } else if (parsedUrl.searchParams.has('__subpath')) {
    subpath = parsedUrl.searchParams.get('__subpath');
  } else if (req.headers && req.headers['x-matched-path']) {
    const matched = req.headers['x-matched-path'];
    if (matched.startsWith('/api/') && matched !== '/api') {
      subpath = matched.slice(5);
    }
  }

  if (subpath) {
    if (!subpath.startsWith('/')) subpath = '/' + subpath;
    parsedUrl.searchParams.delete('__subpath');
    const qs = parsedUrl.searchParams.toString();
    req.url = '/api' + subpath + (qs ? '?' + qs : '');
  }

  return app(req, res);
};

