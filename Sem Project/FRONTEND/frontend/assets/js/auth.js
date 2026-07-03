// frontend/assets/js/auth.js

const API_URL = (() => {
    // Works for http(s) served pages, Live Server, and file:// opening
    if (window.location.protocol === 'file:') return 'http://localhost:5000/api';

    const host = window.location.hostname;
    const port = window.location.port;

    // If frontend is on localhost but different port (e.g., Live Server 5500), assume backend is 5000
    if ((host === 'localhost' || host === '127.0.0.1') && port && port !== '5000') {
        return `http://${host}:5000/api`;
    }

    return `${window.location.origin}/api`;
})();

const signupPanel = document.getElementById("signupPanel");
const loginPanel = document.getElementById("loginPanel");

const adminPanel = document.getElementById("adminPanel");
const forgotPanel = document.getElementById("forgotPanel");
const resetPanel = document.getElementById("resetPanel");

const openLogin = document.getElementById("openLogin");
const openSignup = document.getElementById("openSignup");
const openAdminLogin = document.getElementById("openAdminLogin");
const backToUserLogin = document.getElementById("backToUserLogin");
const openForgotPass = document.getElementById("openForgotPass");
const backToLoginFromForgot = document.getElementById("backToLoginFromForgot");
const backToLoginFromReset = document.getElementById("backToLoginFromReset");

function switchPanel(panel) {
    signupPanel.classList.remove('active');
    loginPanel.classList.remove('active');
    if (adminPanel) adminPanel.classList.remove('active');
    if (forgotPanel) forgotPanel.classList.remove('active');
    if (resetPanel) resetPanel.classList.remove('active');
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

if (openForgotPass) openForgotPass.onclick = (e) => {
    e.preventDefault();
    document.getElementById("forgotErr").style.display = "none";
    document.getElementById("forgotSuccess").style.display = "none";
    document.getElementById("fp_email").value = "";
    switchPanel(forgotPanel);
};

if (backToLoginFromForgot) backToLoginFromForgot.onclick = (e) => {
    e.preventDefault();
    switchPanel(loginPanel);
};

if (backToLoginFromReset) backToLoginFromReset.onclick = (e) => {
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

// ========================
// FORGOT PASSWORD HANDLERS
// ========================

let forgotEmail = '';

// Step 1: Send reset code
const submitForgotPass = document.getElementById("submitForgotPass");
if (submitForgotPass) {
    submitForgotPass.onclick = async () => {
        let email = document.getElementById("fp_email").value.trim().toLowerCase();
        let err = document.getElementById("forgotErr");
        let success = document.getElementById("forgotSuccess");

        err.style.display = "none";
        success.style.display = "none";

        if (!email) { err.textContent = "Please enter your email"; err.style.display = "block"; return; }
        if (!validateEmail(email)) { err.textContent = "Invalid email format"; err.style.display = "block"; return; }

        submitForgotPass.disabled = true;
        submitForgotPass.innerHTML = "Sending... <i class='ri-loader-4-line ri-spin'></i>";

        try {
            let res = await fetch(`${API_URL}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            let data = await res.json();

            if (!res.ok) {
                err.textContent = data.error || "Failed to send reset code";
                err.style.display = "block";
                submitForgotPass.disabled = false;
                submitForgotPass.innerHTML = "Send Reset Code <i class='ri-mail-send-line'></i>";
                return;
            }

            forgotEmail = email;

            // Switch to reset panel (Step 2)
            document.getElementById("resetErr").style.display = "none";
            document.getElementById("resetSuccess").style.display = "none";
            document.getElementById("rp_otp").value = "";
            document.getElementById("rp_newpass").value = "";
            document.getElementById("rp_confirmpass").value = "";

            let resetSuccess = document.getElementById("resetSuccess");
            resetSuccess.textContent = data.message;
            resetSuccess.style.display = "block";
            setTimeout(() => { resetSuccess.style.display = "none"; }, 6000);

            switchPanel(resetPanel);

            submitForgotPass.disabled = false;
            submitForgotPass.innerHTML = "Send Reset Code <i class='ri-mail-send-line'></i>";
        } catch (e) {
            err.textContent = "Server connection error";
            err.style.display = "block";
            submitForgotPass.disabled = false;
            submitForgotPass.innerHTML = "Send Reset Code <i class='ri-mail-send-line'></i>";
        }
    };
}

// Step 2: Verify OTP and set new password
const submitResetPass = document.getElementById("submitResetPass");
if (submitResetPass) {
    submitResetPass.onclick = async () => {
        let otp = document.getElementById("rp_otp").value.trim();
        let newPassword = document.getElementById("rp_newpass").value;
        let confirmPass = document.getElementById("rp_confirmpass").value;
        let err = document.getElementById("resetErr");
        let success = document.getElementById("resetSuccess");

        err.style.display = "none";
        success.style.display = "none";

        if (!otp) { err.textContent = "Enter the 6-digit code"; err.style.display = "block"; return; }
        if (!newPassword) { err.textContent = "Enter new password"; err.style.display = "block"; return; }
        if (newPassword.length < 6) { err.textContent = "Password must be at least 6 characters"; err.style.display = "block"; return; }
        if (newPassword !== confirmPass) { err.textContent = "Passwords do not match"; err.style.display = "block"; return; }

        submitResetPass.disabled = true;
        submitResetPass.innerHTML = "Resetting... <i class='ri-loader-4-line ri-spin'></i>";

        try {
            let res = await fetch(`${API_URL}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: forgotEmail, otp, newPassword })
            });
            let data = await res.json();

            if (!res.ok) {
                err.textContent = data.error || "Reset failed";
                err.style.display = "block";
                submitResetPass.disabled = false;
                submitResetPass.innerHTML = "Reset Password <i class='ri-lock-password-line'></i>";
                return;
            }

            success.textContent = data.message;
            success.style.display = "block";

            submitResetPass.disabled = false;
            submitResetPass.innerHTML = "Reset Password <i class='ri-lock-password-line'></i>";

            // Auto redirect to login after 2.5 seconds
            setTimeout(() => {
                switchPanel(loginPanel);
            }, 2500);

        } catch (e) {
            err.textContent = "Server connection error";
            err.style.display = "block";
            submitResetPass.disabled = false;
            submitResetPass.innerHTML = "Reset Password <i class='ri-lock-password-line'></i>";
        }
    };
}

// Resend reset OTP
const resendResetOtp = document.getElementById("resendResetOtp");
if (resendResetOtp) {
    resendResetOtp.onclick = async () => {
        let err = document.getElementById("resetErr");
        let success = document.getElementById("resetSuccess");
        err.style.display = "none";
        success.style.display = "none";

        if (!forgotEmail) { err.textContent = "Session expired. Go back and try again."; err.style.display = "block"; return; }

        resendResetOtp.disabled = true;
        resendResetOtp.textContent = "Sending...";

        try {
            let res = await fetch(`${API_URL}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: forgotEmail })
            });
            let data = await res.json();

            if (!res.ok) {
                err.textContent = data.error || "Failed to resend";
                err.style.display = "block";
            } else {
                success.textContent = "New reset code sent to your email!";
                success.style.display = "block";
                setTimeout(() => { success.style.display = "none"; }, 4000);
            }

            resendResetOtp.disabled = false;
            resendResetOtp.textContent = "Resend Code";
        } catch (e) {
            err.textContent = "Server connection error";
            err.style.display = "block";
            resendResetOtp.disabled = false;
            resendResetOtp.textContent = "Resend Code";
        }
    };
}
