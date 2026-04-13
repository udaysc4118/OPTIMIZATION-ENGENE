// frontend/assets/js/auth.js

const API_URL = 'http://localhost:5000/api';

const signupPanel = document.getElementById("signupPanel");
const loginPanel = document.getElementById("loginPanel");

const adminPanel = document.getElementById("adminPanel");

const openLogin = document.getElementById("openLogin");
const openSignup = document.getElementById("openSignup");
const openAdminLogin = document.getElementById("openAdminLogin");
const backToUserLogin = document.getElementById("backToUserLogin");

function switchPanel(panel) {
    signupPanel.classList.remove('active');
    loginPanel.classList.remove('active');
    if (adminPanel) adminPanel.classList.remove('active');
    panel.classList.add('active');
}

if (openLogin) openLogin.onclick = (e) => { e.preventDefault(); switchPanel(loginPanel); };
if (openSignup) openSignup.onclick = (e) => { e.preventDefault(); switchPanel(signupPanel); };

if (openAdminLogin) openAdminLogin.onclick = (e) => { 
    e.preventDefault(); 
    localStorage.removeItem("mfp_token");
    localStorage.removeItem("mfp_user");
    document.getElementById("adminErr").style.display = "none";
    switchPanel(adminPanel); 
};

if (backToUserLogin) backToUserLogin.onclick = (e) => { 
    e.preventDefault(); 
    switchPanel(loginPanel); 
};

function validateEmail(mail){ return /\S+@\S+\.\S+/.test(mail); }

let pendingSignup = { name: '', email: '', password: '' };

const submitSignup = document.getElementById("submitSignup");
if (submitSignup) {
    submitSignup.onclick = async () => {
        let name = document.getElementById("su_name").value.trim();
        let email = document.getElementById("su_email").value.trim().toLowerCase();
        let password = document.getElementById("su_pass").value;
        let err = document.getElementById("signupErr");

        err.style.display="none";
        if(!name||!email||!password){ err.textContent="Fill all fields"; err.style.display="block"; return; }
        if(!validateEmail(email)){ err.textContent="Invalid email"; err.style.display="block"; return; }
        if(password.length < 6){ err.textContent="Password min 6 chars"; err.style.display="block"; return; }

        submitSignup.disabled = true;
        submitSignup.innerHTML = "Sending... <i class='ri-loader-4-line ri-spin'></i>";

        try {
            let res = await fetch(`${API_URL}/auth/signup-request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            let data = await res.json();
            
            if (!res.ok) {
                err.textContent = data.error || "Signup failed";
                err.style.display = "block";
                submitSignup.disabled = false;
                submitSignup.innerHTML = "Create Account <i class='ri-arrow-right-line'></i>";
                return;
            }

            pendingSignup = { name, email, password };
            document.getElementById("signupStep1").style.display = "none";
            document.getElementById("signupStep2").style.display = "block";
            
            let otpSuccess = document.getElementById("otpSuccess");
            otpSuccess.textContent = data.message;
            otpSuccess.style.display = "block";
            setTimeout(() => { otpSuccess.style.display = "none"; }, 5000);

            submitSignup.disabled = false;
            submitSignup.innerHTML = "Create Account <i class='ri-arrow-right-line'></i>";
        } catch(e) {
            err.textContent="Server connection error";
            err.style.display="block";
            submitSignup.disabled = false;
            submitSignup.innerHTML = "Create Account <i class='ri-arrow-right-line'></i>";
        }
    };
}

const backToSignup = document.getElementById("backToSignup");
if (backToSignup) {
    backToSignup.onclick = (e) => {
        e.preventDefault();
        document.getElementById("signupStep2").style.display = "none";
        document.getElementById("signupStep1").style.display = "block";
        document.getElementById("otpErr").style.display = "none";
    }
}

const resendOtpBtn = document.getElementById("resendOtpBtn");
if (resendOtpBtn) {
    resendOtpBtn.onclick = async () => {
        let err = document.getElementById("otpErr");
        let success = document.getElementById("otpSuccess");
        err.style.display = "none";
        success.style.display = "none";
        
        resendOtpBtn.disabled = true;
        resendOtpBtn.textContent = "Sending...";

        try {
            let res = await fetch(`${API_URL}/auth/resend-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: pendingSignup.email })
            });
            let data = await res.json();
            
            if (!res.ok) {
                err.textContent = data.error || "Failed to resend";
                err.style.display = "block";
                resendOtpBtn.disabled = false;
                resendOtpBtn.textContent = "Resend Code";
                return;
            }

            success.textContent = "Code resent securely!";
            success.style.display = "block";
            resendOtpBtn.disabled = false;
            resendOtpBtn.textContent = "Resend Code";
            setTimeout(() => { success.style.display = "none"; }, 4000);
        } catch(e) {
            err.textContent="Server connection error";
            err.style.display="block";
            resendOtpBtn.disabled = false;
            resendOtpBtn.textContent = "Resend Code";
        }
    }
}

const verifyOtpBtn = document.getElementById("verifyOtpBtn");
if (verifyOtpBtn) {
    verifyOtpBtn.onclick = async () => {
        let otp = document.getElementById("su_otp").value.trim();
        let err = document.getElementById("otpErr");

        err.style.display="none";
        if(!otp) { err.textContent="Enter your 6-digit code"; err.style.display="block"; return; }

        verifyOtpBtn.disabled = true;
        verifyOtpBtn.innerHTML = "Verifying... <i class='ri-loader-4-line ri-spin'></i>";

        try {
            let res = await fetch(`${API_URL}/auth/signup-verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...pendingSignup, otp })
            });
            let data = await res.json();
            
            if (!res.ok) {
                err.textContent = data.error || "Verification failed";
                err.style.display="block";
                verifyOtpBtn.disabled = false;
                verifyOtpBtn.innerHTML = "Verify & Access";
                return;
            }

            localStorage.setItem("mfp_token", data.token);
            localStorage.setItem("mfp_user", JSON.stringify(data.user));
            window.location="index.html";
        } catch(e) {
            err.textContent="Server connection error";
            err.style.display="block";
            verifyOtpBtn.disabled = false;
            verifyOtpBtn.innerHTML = "Verify & Access";
        }
    };
}

const submitLogin = document.getElementById("submitLogin");
if (submitLogin) {
    submitLogin.onclick = async () => {
        let email = document.getElementById("li_email").value.trim().toLowerCase();
        let password = document.getElementById("li_pass").value;
        let err = document.getElementById("loginErr");

        err.style.display="none";
        if(!email||!password){ err.textContent="Please fill out all fields"; err.style.display="block"; return; }

        submitLogin.disabled = true;
        submitLogin.innerHTML = "Authenticating... <i class='ri-loader-4-line ri-spin'></i>";

        try {
            let res = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            let data = await res.json();
            
            if (!res.ok) {
                err.textContent= data.error || "Invalid credentials";
                err.style.display="block";
                submitLogin.disabled = false;
                submitLogin.innerHTML = "Sign In <i class='ri-login-box-line'></i>";
                return;
            }

            localStorage.setItem("mfp_token", data.token);
            localStorage.setItem("mfp_user", JSON.stringify(data.user));
            
            if (data.user.role === 'admin') {
                window.location="admin.html";
            } else {
                window.location="index.html";
            }
        } catch(e) {
            err.textContent="Server connection error";
            err.style.display="block";
            submitLogin.disabled = false;
            submitLogin.innerHTML = "Sign In <i class='ri-login-box-line'></i>";
        }
    };
}

// ADMIN LOGIN HANDLER
const adminForm = document.getElementById("adminForm");
const submitAdminLogin = document.getElementById("submitAdminLogin");

if (adminForm) {
    adminForm.onsubmit = async (e) => {
        e.preventDefault();
        let email = document.getElementById("admin_email").value.trim().toLowerCase();
        let password = document.getElementById("admin_pass").value;
        let err = document.getElementById("adminErr");

        err.style.display="none";
        if(!email||!password){ err.textContent="Please verify credentials."; err.style.display="block"; return; }

        submitAdminLogin.disabled = true;
        submitAdminLogin.innerHTML = "Verifying Clearance... <i class='ri-loader-4-line ri-spin'></i>";

        try {
            let res = await fetch(`${API_URL}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_id: email, password }) // Send admin_id mapped appropriately!
            });
            let data = await res.json();
            
            if (!res.ok) {
                err.textContent= data.error || "Invalid clearance credentials";
                err.style.display="block";
                submitAdminLogin.disabled = false;
                submitAdminLogin.innerHTML = "Verify Clearance <i class='ri-shield-check-line'></i>";
                return;
            }

            // Trust the token explicitly for an admin!
            if (data.token) {
                localStorage.setItem("mfp_token", data.token);
                // Hardcode standard UI payload since endpoint only strictly issues token
                localStorage.setItem("mfp_user", JSON.stringify({ id: email, name: 'System Admin', role: 'admin' }));
                window.location = "admin.html";
            }
        } catch(e) {
            err.textContent="Server connection error";
            err.style.display="block";
            submitAdminLogin.disabled = false;
            submitAdminLogin.innerHTML = "Verify Clearance <i class='ri-shield-check-line'></i>";
        }
    };
}
