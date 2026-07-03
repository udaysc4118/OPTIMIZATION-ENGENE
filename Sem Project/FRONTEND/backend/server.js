const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
let bcrypt;
try {
    bcrypt = require('bcrypt');
} catch (e) {
    bcrypt = require('bcryptjs');
}
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Node <18 compatibility (used by AI distance/geocoding and optional OpenAI calls)
const fetch = global.fetch || require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

let initPromise = null;

// Health check (no auth) to verify backend is up
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        time: new Date().toISOString(),
        port: process.env.PORT || 5000
    });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase;

const isVercelRuntime = Boolean(process.env.VERCEL);
const runtimeDataDir = isVercelRuntime ? path.join('/tmp', 'maharoute-data') : __dirname;
const DB_FILE = path.join(runtimeDataDir, 'local_db.json');
const AI_PERMISSIONS_PATH = path.join(runtimeDataDir, 'ai_permissions.json');

function ensureRuntimeDataDir() {
    if (!fs.existsSync(runtimeDataDir)) {
        fs.mkdirSync(runtimeDataDir, { recursive: true });
    }
}

function seedRuntimeFile(targetPath, sourcePath, fallbackContent) {
    ensureRuntimeDataDir();
    if (fs.existsSync(targetPath)) return;
    if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, targetPath);
        return;
    }
    fs.writeFileSync(targetPath, fallbackContent, 'utf8');
}

// Local Database Mock implementation for Offline Mode

function readLocalDb() {
    if (!fs.existsSync(DB_FILE)) {
        const defaultDb = {
            users: [],
            otps: [],
            admins: [
                {
                    id: "admin-uuid-1",
                    admin_id: "admin@maharoute.ai",
                    password_hash: "$2b$10$U6Uj1G8F/f3xN2j791mGvea1Kk5tP34U67/wQn6zTz/z6wS1Q11qG" // Password: admin123
                }
            ],
            messages: []
        };
        seedRuntimeFile(
            DB_FILE,
            path.join(__dirname, 'local_db.json'),
            JSON.stringify(defaultDb, null, 2)
        );
        return defaultDb;
    }
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return { users: [], otps: [], admins: [], messages: [] };
    }
}

function writeLocalDb(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function createLocalSupabaseMock() {
    return {
        from: (table) => {
            const builder = {
                table: table,
                _eq: [],
                _gte: [],
                _select: '*',
                _order: null,
                _limit: null,
                _single: false,
                _op: 'select',
                _insertData: null,
                _updateData: null,

                select: function(fields) {
                    this._select = fields;
                    return this;
                },
                eq: function(col, val) {
                    this._eq.push({ col, val });
                    return this;
                },
                gte: function(col, val) {
                    this._gte.push({ col, val });
                    return this;
                },
                single: function() {
                    this._single = true;
                    return this;
                },
                order: function(col, opts) {
                    this._order = { col, ascending: opts?.ascending !== false };
                    return this;
                },
                limit: function(val) {
                    this._limit = val;
                    return this;
                },
                insert: function(records) {
                    this._op = 'insert';
                    this._insertData = records;
                    return this;
                },
                update: function(updates) {
                    this._op = 'update';
                    this._updateData = updates;
                    return this;
                },
                delete: function() {
                    this._op = 'delete';
                    return this;
                },

                then: function(resolve) {
                    let db = readLocalDb();
                    let data = db[this.table] || [];

                    if (this._op === 'select') {
                        let result = [...data];
                        this._eq.forEach(filter => {
                            result = result.filter(item => String(item[filter.col]) === String(filter.val));
                        });
                        this._gte.forEach(filter => {
                            result = result.filter(item => new Date(item[filter.col]) >= new Date(filter.val));
                        });

                        if (this._order) {
                            const { col, ascending } = this._order;
                            result.sort((a, b) => {
                                let valA = a[col];
                                let valB = b[col];
                                if (valA === undefined) return 1;
                                if (valB === undefined) return -1;
                                if (typeof valA === 'string') {
                                    return ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
                                }
                                return ascending ? (valA - valB) : (valB - valA);
                            });
                        }

                        if (this._limit !== null) {
                            result = result.slice(0, this._limit);
                        }

                        let finalData = this._single ? (result[0] || null) : result;
                        let error = null;
                        if (this._single && !result[0]) {
                            error = { message: 'Row not found', code: 'PGRST116' };
                        }
                        resolve({ data: finalData, error });

                    } else if (this._op === 'insert') {
                        const records = this._insertData;
                        const newRecords = (Array.isArray(records) ? records : [records]).map(r => {
                            const item = {
                                id: r.id || Math.random().toString(36).substring(2, 15),
                                created_at: new Date().toISOString(),
                                ...r
                            };
                            if (this.table === 'users' && item.is_active === undefined) {
                                item.is_active = true;
                            }
                            db[this.table].push(item);
                            return item;
                        });
                        writeLocalDb(db);
                        let finalData = Array.isArray(records) ? newRecords : newRecords[0];
                        if (this._single) {
                            finalData = newRecords[0];
                        }
                        resolve({ data: finalData, error: null });

                    } else if (this._op === 'update') {
                        let updatedItems = [];
                        db[this.table] = db[this.table].map(item => {
                            const matchesEq = this._eq.every(filter => String(item[filter.col]) === String(filter.val));
                            if (matchesEq) {
                                const updated = { ...item, ...this._updateData };
                                updatedItems.push(updated);
                                return updated;
                            }
                            return item;
                        });
                        writeLocalDb(db);
                        let finalData = this._single ? (updatedItems[0] || null) : updatedItems;
                        resolve({ data: finalData, error: null });

                    } else if (this._op === 'delete') {
                        db[this.table] = db[this.table].filter(item => {
                            const matchesEq = this._eq.every(filter => String(item[filter.col]) === String(filter.val));
                            return !matchesEq;
                        });
                        writeLocalDb(db);
                        resolve({ data: null, error: null });
                    }
                }
            };
            return builder;
        },
        rpc: async function(fn, args) {
            if (fn === 'check_admin_pass') {
                const db = readLocalDb();
                const admin = db.admins.find(a => a.admin_id === args.a_id);
                if (!admin) return { data: false, error: null };
                const match = await bcrypt.compare(args.a_pass, admin.password_hash);
                return { data: match, error: null };
            }
            return { data: null, error: { message: 'RPC not implemented' } };
        }
    };
}

const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_ONLINE_TIMEOUT_MS = 70000;
const AUTO_WAITING_MESSAGE = 'Admin is currently offline. Please wait, your message has been received and you will get a reply shortly.';
let adminLastSeenAt = 0;

// Simple file-based AI permissions store (userId -> boolean)
function ensureAiPermissionsFile() {
    seedRuntimeFile(
        AI_PERMISSIONS_PATH,
        path.join(__dirname, 'ai_permissions.json'),
        JSON.stringify({})
    );
}
function readAiPermissions() {
    ensureAiPermissionsFile();
    try {
        return JSON.parse(fs.readFileSync(AI_PERMISSIONS_PATH, 'utf8') || '{}');
    } catch (e) {
        return {};
    }
}
function writeAiPermissions(obj) {
    fs.writeFileSync(AI_PERMISSIONS_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

function isAdminOnline() {
    return adminLastSeenAt && (Date.now() - adminLastSeenAt) < ADMIN_ONLINE_TIMEOUT_MS;
}

// Middleware to verify JWT for protected routes (Admin only)
function verifyAdminToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'No token provided.' });
    
    const tokenPart = token.split(' ')[1] || token;
    
    jwt.verify(tokenPart, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Failed to authenticate token.' });
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Requires admin role.' });
        req.adminId = decoded.id;
        next();
    });
}

// Generate an ethereal test account globally to avoid delay
let transporter;
nodemailer.createTestAccount().then(account => {
    transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: {
            user: account.user,
            pass: account.pass
        }
    });
    console.log("Nodemailer Ethereal SMTP ready! Check logs for preview URLs containing your 6 digit code.");
}).catch(err => {
    console.warn("Failed to reach Nodemailer Ethereal API, email sending will fallback to default SMTP credentials if available or fail gracefully.");
});

async function sendOtpEmail(email, otp) {
    // If user sets real SMTP creds in .env, use them (like Gmail App Passwords)
    let activeTransporter = transporter;
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        activeTransporter = nodemailer.createTransport({
            service: 'gmail', // or configured host
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    if (!activeTransporter) throw new Error("Transporter not ready");

    let info = await activeTransporter.sendMail({
        from: '"MahaRoute Security" <noreply@maharoute.ai>',
        to: email,
        subject: `Your MahaRoute Verification Code: ${otp}`,
        html: `
            <div style="font-family: Arial, sans-serif; background: #0a0c12; padding: 40px; color: #ffffff; border-radius: 10px; max-width: 600px; margin: 0 auto; text-align: center;">
                <h1 style="color: #fb923c;">MahaRoute AI</h1>
                <p style="font-size: 16px; color: #a0a0a0;">Here is your secure One-Time Password to complete your registration:</p>
                <div style="font-size: 36px; font-weight: bold; letter-spacing: 5px; color: #ffffff; background: #1a1e2a; border: 2px dashed #fb923c; padding: 20px; border-radius: 15px; margin: 30px 0;">
                    ${otp}
                </div>
                <p style="font-size: 14px; color: #a0a0a0;">This code is valid for exactly 10 minutes. Please do not share it.</p>
                <div style="margin-top: 40px; text-align: left; padding-top: 25px; border-top: 1px solid rgba(251, 146, 60, 0.3);">
                    <p style="font-size: 15.5px; color: #e2e8f0; line-height: 1.7;">
                        Thank you so much for choosing our route app! We are incredibly grateful to have you on board with us. 
                        Our team has worked extremely hard to build this intelligent platform, and your support means the world to us. 
                        We truly hope that our advanced routing algorithms and premium features help make your journeys significantly faster, smarter, and more efficient. 
                        If you ever need any assistance or have feedback, please don't hesitate to reach out. 
                        Welcome to the MahaRoute family—let's explore the beautiful state of Maharashtra together like never before!
                    </p>
                    <p style="font-size: 15px; color: #fb923c; font-weight: bold; margin-top: 25px;">
                        Warm Regards,<br>
                        The MahaRoute AI Team
                    </p>
                </div>
            </div>
        `
    });
    
    // Auto-generate a beautiful web preview link without needing a real email inbox!
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if(previewUrl) {
       console.log(`\n\n[DEV ENVIRONMENT] Email intercepted successfully!`);
       console.log(`View the stunning OTP Email containing the code here: ${previewUrl}\n\n`);
    } else {
       console.log(`\n\n[REAL PRODUCTION] Email successfully sent to ${email}!!\n\n`);
    }
}

// ========================
// AUTH ROUTES (Users)
// ========================

// Sign Up Request (Generates Custom OTP using Nodemailer + Otps table)
app.post('/api/auth/signup-request', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required' });

        // Block if email exists in public.users
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        if (existingUser) return res.status(400).json({ error: 'Email already registered' });

        // Generate customized secure 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // Expires in 10 minutes
        const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();

        // Expire/cleanup previous OTPs for this email
        await supabase.from('otps').delete().eq('email', email);

        // Save new OTP
        const { error: insertError } = await supabase.from('otps').insert([{ email, otp, expires_at: expiresAt }]);
        if (insertError) throw insertError;

        // Dispatch Email dynamically
        await sendOtpEmail(email, otp);

        res.json({ message: 'A 6-digit OTP code has been instantly sent to your email!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error generating OTP' });
    }
});

// Resend OTP
app.post('/api/auth/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        
        // Generate customized secure 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();

        await supabase.from('otps').delete().eq('email', email);
        const { error: insertError } = await supabase.from('otps').insert([{ email, otp, expires_at: expiresAt }]);
        if (insertError) throw insertError;

        await sendOtpEmail(email, otp);
        res.json({ message: 'A fresh OTP code has been resent!' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Sign Up Verify
app.post('/api/auth/signup-verify', async (req, res) => {
    try {
        const { name, email, password, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

        // Verify Custom OTP
        const { data: record, error: fetchError } = await supabase
            .from('otps')
            .select('*')
            .eq('email', email)
            .eq('otp', otp)
            .single();

        if (fetchError || !record) return res.status(400).json({ error: 'Invalid or expired OTP code' });
        
        // Check Expiration
        if (new Date(record.expires_at) < new Date()) {
            await supabase.from('otps').delete().eq('id', record.id);
            return res.status(400).json({ error: 'This OTP has expired' });
        }

        // OTP Validated! 
        // Hash password for public.users
        const password_hash = await bcrypt.hash(password, 10);

        // Insert into public.users beautifully completely independent of Supabase Auth limits
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert([{ name, email, password_hash }])
            .select()
            .single();

        if (insertError) {
             if (insertError.code === '23505') return res.status(400).json({ error: 'User already exists!' });
             throw insertError;
        }

        // Clean up OTP to prevent replay attacks
        await supabase.from('otps').delete().eq('email', email);

        // Issue token
        const appToken = jwt.sign({ id: newUser.id, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'User created securely', token: appToken, user: { name: newUser.name, email: newUser.email } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error during OTP verification' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) return res.status(400).json({ error: 'Invalid credentials' });
        if (user.is_active === false) return res.status(403).json({ error: 'Account deactivated by an administrator.' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ error: 'Invalid credentials' });

        // Update last login telemetry
        await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);

        const token = jwt.sign({ id: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'Logged in successfully', token, user: { name: user.name, email: user.email } });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// ========================
// FORGOT PASSWORD ROUTES
// ========================

// Step 1: Request password reset OTP
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        // Check if user exists
        const { data: user, error } = await supabase
            .from('users')
            .select('id, name, email')
            .eq('email', email.toLowerCase())
            .single();

        if (error || !user) return res.status(400).json({ error: 'No account found with this email address' });

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();

        // Cleanup old OTPs for this email
        await supabase.from('otps').delete().eq('email', email.toLowerCase());

        // Save new OTP
        const { error: insertError } = await supabase.from('otps').insert([{ email: email.toLowerCase(), otp, expires_at: expiresAt }]);
        if (insertError) throw insertError;

        // Send OTP via email
        let activeTransporter = transporter;
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            activeTransporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });
        }
        if (!activeTransporter) throw new Error("Transporter not ready");

        let info = await activeTransporter.sendMail({
            from: '"MahaRoute Security" <noreply@maharoute.ai>',
            to: email,
            subject: `Password Reset Code: ${otp}`,
            html: `
                <div style="font-family: Arial, sans-serif; background: #0a0c12; padding: 40px; color: #ffffff; border-radius: 10px; max-width: 600px; margin: 0 auto; text-align: center;">
                    <h1 style="color: #fb923c;">MahaRoute AI</h1>
                    <p style="font-size: 16px; color: #a0a0a0;">You requested a password reset. Here is your secure code:</p>
                    <div style="font-size: 36px; font-weight: bold; letter-spacing: 5px; color: #ffffff; background: #1a1e2a; border: 2px dashed #ef4444; padding: 20px; border-radius: 15px; margin: 30px 0;">
                        ${otp}
                    </div>
                    <p style="font-size: 14px; color: #a0a0a0;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
                    <p style="font-size: 15px; color: #fb923c; font-weight: bold; margin-top: 25px;">— The MahaRoute AI Team</p>
                </div>
            `
        });

        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
            console.log(`\n[DEV] Password Reset OTP Email preview: ${previewUrl}\n`);
        }

        res.json({ message: 'Password reset code sent to your email!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error sending reset code' });
    }
});

// Step 2: Verify OTP and set new password
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) return res.status(400).json({ error: 'All fields are required' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        // Verify OTP
        const { data: record, error: fetchError } = await supabase
            .from('otps')
            .select('*')
            .eq('email', email.toLowerCase())
            .eq('otp', otp)
            .single();

        if (fetchError || !record) return res.status(400).json({ error: 'Invalid or expired reset code' });

        // Check expiration
        if (new Date(record.expires_at) < new Date()) {
            await supabase.from('otps').delete().eq('id', record.id);
            return res.status(400).json({ error: 'This reset code has expired. Please request a new one.' });
        }

        // Hash new password
        const password_hash = await bcrypt.hash(newPassword, 10);

        // Update user password
        const { error: updateError } = await supabase
            .from('users')
            .update({ password_hash })
            .eq('email', email.toLowerCase());

        if (updateError) throw updateError;

        // Cleanup OTP
        await supabase.from('otps').delete().eq('email', email.toLowerCase());

        res.json({ message: 'Password reset successful! You can now login with your new password.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error resetting password' });
    }
});

// ========================
// ADMIN ROUTES
// ========================
// Admin Login
app.post('/api/admin/login', async (req, res) => {
    try {
        const { admin_id, password } = req.body;
        if (!admin_id || !password) return res.status(400).json({ error: 'Admin ID and password required' });

        const { data: admin, error } = await supabase
            .from('admins')
            .select('*')
            .eq('admin_id', admin_id)
            .single();

        if (error || !admin) return res.status(400).json({ error: 'Invalid Admin credentials' });

        let match = false;
        if (admin.password_hash.startsWith('$2a$') || admin.password_hash.startsWith('$2b$')) {
            match = await bcrypt.compare(password, admin.password_hash);
        } else {
             const { data: pgcryptRes } = await supabase.rpc('check_admin_pass', { a_id: admin_id, a_pass: password });
             match = pgcryptRes;
        }

        if (!match) return res.status(400).json({ error: 'Invalid Admin credentials' });

        const token = jwt.sign({ id: admin.id, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'Admin logged in', token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error during admin login' });
    }
});

// Get all users
app.get('/api/admin/users', verifyAdminToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('users').select('id, name, email, created_at, is_active, last_login_at').order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ users: data });
    } catch (err) { res.status(500).json({ error: 'Failed to fetch users' }); }
});

// Toggle User Status
app.put('/api/admin/users/:id/toggle', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        const { error } = await supabase.from('users').update({ is_active }).eq('id', id);
        if (error) throw error;
        res.json({ message: 'Operative status updated securely' });
    } catch (err) { res.status(500).json({ error: 'Failed to update user status' }); }
});

// Edit user
app.put('/api/admin/users/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params; const { name, email } = req.body;
        if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
        const { data, error } = await supabase.from('users').update({ name, email }).eq('id', id).select('id, name, email, created_at').single();
        if (error) throw error;
        res.json({ message: 'User updated successfully', user: data });
    } catch (err) { res.status(500).json({ error: 'Failed to update user' }); }
});

// Delete user
app.delete('/api/admin/users/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase.from('users').delete().eq('id', id);
        if (error) throw error;
        res.json({ message: 'User deleted successfully' });
    } catch (err) { res.status(500).json({ error: 'Failed to delete user' }); }
});

// ========================
// USER TOKEN MIDDLEWARE
// ========================
function verifyUserToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'No token provided.' });
    const tokenPart = token.split(' ')[1] || token;
    jwt.verify(tokenPart, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Failed to authenticate.' });
        req.userId = decoded.id;
        req.userRole = decoded.role;
        next();
    });
}

// ========================
// WEATHER PROXY
// ========================
app.get('/api/weather', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        const resp = await fetch(`https://wttr.in/${lat},${lon}?format=j1`);
        const data = await resp.json();
        const current = data.current_condition[0];
        res.json({
            temp: current.temp_C,
            feels: current.FeelsLikeC,
            desc: current.weatherDesc[0].value,
            humidity: current.humidity,
            wind: current.windspeedKmph,
            icon: current.weatherCode
        });
    } catch (err) {
        res.status(500).json({ error: 'Weather fetch failed' });
    }
});

// ========================
// CHAT ROUTES
// ========================

// Admin heartbeat to mark availability
app.post('/api/admin/chat/heartbeat', verifyAdminToken, async (req, res) => {
    adminLastSeenAt = Date.now();
    res.json({ online: true, lastSeenAt: adminLastSeenAt });
});

// Admin: grant or revoke AI access to a user
app.put('/api/admin/ai-permissions/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { allowed } = req.body;
        if (typeof allowed !== 'boolean') return res.status(400).json({ error: 'allowed(boolean) required' });
        const perms = readAiPermissions();
        perms[userId] = allowed;
        writeAiPermissions(perms);
        res.json({ success: true, userId, allowed });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update AI permissions' });
    }
});

// Check if a user has AI access
app.get('/api/ai/permissions/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const perms = readAiPermissions();
        res.json({ allowed: !!perms[userId] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to read AI permissions' });
    }
});

// User checks if they themselves have AI access
app.get('/api/ai/my-access', verifyUserToken, async (req, res) => {
    try {
        const perms = readAiPermissions();
        res.json({ allowed: !!perms[req.userId] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to read AI permissions' });
    }
});

// AI Chat endpoint: accepts simple distance queries or free-text fallback
app.post('/api/ai/query', verifyUserToken, async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'query required' });

        // Check permissions
        const perms = readAiPermissions();
        if (!perms[req.userId]) return res.status(403).json({ error: 'AI access not enabled for this user' });

        // Simple parsing: detect "distance from X to Y" patterns
        const distMatch = query.match(/distance\s+(?:from\s+)?([A-Za-z ]+)\s+(?:to|and)\s+([A-Za-z ]+)/i);
        if (distMatch) {
            const cityA = distMatch[1].trim();
            const cityB = distMatch[2].trim();
            // Use Open-Meteo geocoding to get coords then compute haversine distance
            async function geocode(name) {
                const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
                const r = await fetch(url);
                if (!r.ok) return null;
                const d = await r.json();
                if (!d || !Array.isArray(d.results) || d.results.length === 0) return null;
                return d.results[0];
            }

            const a = await geocode(cityA);
            const b = await geocode(cityB);
            if (!a || !b) return res.json({ answer: `Could not geocode one of the cities: ${cityA} or ${cityB}` });

            function haversine(lat1, lon1, lat2, lon2) {
                const R = 6371; // km
                const toRad = (v) => v * Math.PI / 180;
                const dLat = toRad(lat2 - lat1);
                const dLon = toRad(lon2 - lon1);
                const la1 = toRad(lat1); const la2 = toRad(lat2);
                const aHar = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
                const c = 2 * Math.atan2(Math.sqrt(aHar), Math.sqrt(1-aHar));
                return R * c;
            }

            const distKm = haversine(a.latitude, a.longitude, b.latitude, b.longitude);
            return res.json({ answer: `${cityA} ↔ ${cityB}: approx ${distKm.toFixed(1)} km (great-circle)` });
        }

        // Fallback: simple safe echo (or call external LLM if API key present)
        if (process.env.OPENAI_API_KEY) {
            // Keep this optional; use fetch to call OpenAI if available
            const oaRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: query }], max_tokens: 300 })
            });
            const j = await oaRes.json();
            const text = j?.choices?.[0]?.message?.content || 'No response';
            return res.json({ answer: text });
        }

        // If no LLM configured, return helpful template
        return res.json({ answer: `AI not configured. Detected query: "${query}". To enable richer answers set OPENAI_API_KEY in backend env.` });

    } catch (err) {
        console.error('AI query error', err);
        res.status(500).json({ error: 'AI query failed' });
    }
});

// Admin AI Chat endpoint (admin can use AI without per-user permission)
app.post('/api/admin/ai/query', verifyAdminToken, async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'query required' });

        const distMatch = query.match(/distance\s+(?:from\s+)?([A-Za-z ]+)\s+(?:to|and)\s+([A-Za-z ]+)/i);
        if (distMatch) {
            const cityA = distMatch[1].trim();
            const cityB = distMatch[2].trim();
            async function geocode(name) {
                const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
                const r = await fetch(url);
                if (!r.ok) return null;
                const d = await r.json();
                if (!d || !Array.isArray(d.results) || d.results.length === 0) return null;
                return d.results[0];
            }
            const a = await geocode(cityA);
            const b = await geocode(cityB);
            if (!a || !b) return res.json({ answer: `Could not geocode one of the cities: ${cityA} or ${cityB}` });

            function haversine(lat1, lon1, lat2, lon2) {
                const R = 6371;
                const toRad = (v) => v * Math.PI / 180;
                const dLat = toRad(lat2 - lat1);
                const dLon = toRad(lon2 - lon1);
                const la1 = toRad(lat1);
                const la2 = toRad(lat2);
                const aHar = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
                const c = 2 * Math.atan2(Math.sqrt(aHar), Math.sqrt(1 - aHar));
                return R * c;
            }

            const distKm = haversine(a.latitude, a.longitude, b.latitude, b.longitude);
            return res.json({ answer: `${cityA} ↔ ${cityB}: approx ${distKm.toFixed(1)} km (great-circle)` });
        }

        if (process.env.OPENAI_API_KEY) {
            const oaRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: query }],
                    max_tokens: 300
                })
            });
            const j = await oaRes.json();
            const text = j?.choices?.[0]?.message?.content || 'No response';
            return res.json({ answer: text });
        }

        return res.json({ answer: `AI not configured. Detected query: "${query}". To enable richer answers set OPENAI_API_KEY in backend env.` });
    } catch (err) {
        console.error('Admin AI query error', err);
        res.status(500).json({ error: 'AI query failed' });
    }
});

// User can check admin availability
app.get('/api/chat/status', verifyUserToken, async (req, res) => {
    res.json({ adminOnline: isAdminOnline() });
});

// User sends a message
app.post('/api/chat/send', verifyUserToken, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

        // Get user details
        const { data: user } = await supabase.from('users').select('name, email').eq('id', req.userId).single();
        if (!user) return res.status(400).json({ error: 'User not found' });

        // Insert user message
        const { error } = await supabase.from('messages').insert([{
            user_id: req.userId,
            user_name: user.name,
            user_email: user.email,
            sender_type: 'user',
            message: message.trim()
        }]);
        if (error) throw error;

        // Check if admin is online
        const adminIsOnline = isAdminOnline();
        console.log(`[Chat] User ${req.userId} sent message. Admin online status: ${adminIsOnline}`);

        if (!adminIsOnline) {
            console.log(`[Chat] Admin is offline. Sending auto-waiting message to user ${req.userId}`);
            
            // Check if we already sent a waiting message in the last 10 minutes
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const { data: existingAutoMsg, error: checkError } = await supabase
                .from('messages')
                .select('id')
                .eq('user_id', req.userId)
                .eq('sender_type', 'admin')
                .eq('message', AUTO_WAITING_MESSAGE)
                .gte('created_at', tenMinutesAgo)
                .order('created_at', { ascending: false })
                .limit(1);

            if (checkError) console.error(`[Chat] Error checking existing message: ${checkError.message}`);

            if (!existingAutoMsg || existingAutoMsg.length === 0) {
                // Insert the auto-waiting response message
                const { error: insertError } = await supabase.from('messages').insert([{
                    user_id: req.userId,
                    user_name: user.name,
                    user_email: user.email,
                    sender_type: 'admin',
                    message: AUTO_WAITING_MESSAGE,
                    is_read: false
                }]);
                
                if (insertError) {
                    console.error(`[Chat] Failed to insert auto-waiting message: ${insertError.message}`);
                } else {
                    console.log(`[Chat] Auto-waiting message sent to user ${req.userId}`);
                }
            } else {
                console.log(`[Chat] Auto-waiting message already sent in last 10 minutes for user ${req.userId}`);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error(`[Chat Send Error] ${err.message}`, err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// User gets their chat history
app.get('/api/chat/messages', verifyUserToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('user_id', req.userId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        res.json({ messages: data || [] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Admin gets list of users who have chatted
app.get('/api/admin/chat/users', verifyAdminToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('user_id, user_name, user_email, created_at, is_read, sender_type')
            .order('created_at', { ascending: false });
        if (error) throw error;

        // Group by user_id and get latest message info
        const userMap = {};
        (data || []).forEach(msg => {
            if (!userMap[msg.user_id]) {
                userMap[msg.user_id] = {
                    user_id: msg.user_id,
                    user_name: msg.user_name,
                    user_email: msg.user_email,
                    last_message_at: msg.created_at,
                    unread: 0
                };
            }
            if (msg.sender_type === 'user' && !msg.is_read) {
                userMap[msg.user_id].unread++;
            }
        });
        res.json({ users: Object.values(userMap) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch chat users' });
    }
});

// Admin gets messages for a specific user
app.get('/api/admin/chat/messages/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;

        // Mark user messages as read
        await supabase.from('messages').update({ is_read: true }).eq('user_id', userId).eq('sender_type', 'user');

        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });
        if (error) throw error;
        res.json({ messages: data || [] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Admin replies to a user
app.post('/api/admin/chat/reply', verifyAdminToken, async (req, res) => {
    try {
        const { userId, message } = req.body;
        if (!userId || !message) return res.status(400).json({ error: 'userId and message required' });

        // Get user info
        const { data: user } = await supabase.from('users').select('name, email').eq('id', userId).single();
        if (!user) return res.status(400).json({ error: 'User not found' });

        const { error } = await supabase.from('messages').insert([{
            user_id: userId,
            user_name: user.name,
            user_email: user.email,
            sender_type: 'admin',
            message: message.trim(),
            is_read: false
        }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to send reply' });
    }
});

// Admin deletes all messages for a user
app.delete('/api/admin/chat/delete/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ error: 'userId required' });

        const { error } = await supabase.from('messages').delete().eq('user_id', userId);
        if (error) throw error;
        res.json({ success: true, message: 'Chat deleted' });
    } catch (err) {
        console.error('Delete chat error:', err);
        res.status(500).json({ error: 'Failed to delete chat' });
    }
});

// Dev: revert login page to backup (saves previous state before promo insertion)
app.post('/api/revert-login', verifyUserToken, async (req, res) => {
    try {
        if (isVercelRuntime) {
            return res.status(501).json({ error: 'Revert is disabled on Vercel runtime' });
        }
        const backupPath = path.join(__dirname, '..', 'frontend', 'login.html.bak');
        const targetPath = path.join(__dirname, '..', 'frontend', 'login.html');
        if (!fs.existsSync(backupPath)) return res.status(404).json({ error: 'Backup not found' });
        const content = fs.readFileSync(backupPath, 'utf8');
        fs.writeFileSync(targetPath, content, 'utf8');
        return res.json({ success: true });
    } catch (err) {
        console.error('Revert failed', err);
        return res.status(500).json({ error: 'Revert failed' });
    }
});

// Catch-all: serve frontend index for any non-API route
app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});

function isSupabaseFatalInitError(message) {
    const msg = String(message || '').toLowerCase();
    return msg.includes('permission denied')
        || msg.includes('row-level security')
        || msg.includes('invalid api key')
        || msg.includes('invalid jwt')
        || msg.includes('jwt malformed')
        || msg.includes('relation')
        || msg.includes('does not exist');
}

async function initializeDataBackends() {
    if (supabaseUrl && supabaseKey) {
        try {
            const cloud = createClient(supabaseUrl, supabaseKey);
            const { error } = await cloud.from('users').select('id').limit(1);

            if (error && isSupabaseFatalInitError(error.message)) {
                console.log('⚠️  Supabase access blocked (RLS/key/schema). Falling back to local JSON database.');
                supabase = createLocalSupabaseMock();
                return;
            }

            console.log('✅ Supabase credentials detected. Using cloud database.');
            supabase = cloud;
            return;
        } catch (err) {
            console.log('⚠️  Supabase initialization failed. Falling back to local JSON database.');
            supabase = createLocalSupabaseMock();
            return;
        }
    }

    console.log('⚠️  Supabase credentials missing. Falling back to local JSON database.');
    supabase = createLocalSupabaseMock();
}

async function ensureBackendReady(req, res, next) {
    try {
        if (!initPromise) {
            initPromise = initializeDataBackends();
        }
        await initPromise;
        next();
    } catch (err) {
        console.error('Backend init failed', err);
        res.status(500).json({ error: 'Backend initialization failed' });
    }
}

app.use('/api', ensureBackendReady);

function startServer() {
    if (!initPromise) {
        initPromise = initializeDataBackends();
    }

    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
        console.log(`\n🚀 MahaRoute Backend running on http://localhost:${PORT}`);
        console.log(`🌐 Frontend served at http://localhost:${PORT}/login.html`);
        console.log(`🩺 Health check: http://localhost:${PORT}/api/health\n`);
    });

    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            console.error(`\n❌ Port ${PORT} is already in use.`);
            console.error('Close the other running server (Ctrl+C) or stop the node process using that port, then start again.\n');
            process.exit(1);
        }
        console.error('\n❌ Server failed to start:', err);
        process.exit(1);
    });
}

if (require.main === module) {
    startServer();
}

module.exports = app;
