const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const JWT_SECRET = process.env.JWT_SECRET;

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Unlimited Nodemailer Backend running securely on port ${PORT}`);
});
