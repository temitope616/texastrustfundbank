import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { FieldError, InlineError, PageHeading, PasswordInput } from '../components/BankingUI.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ProfilePage() {
  const { token, user, updateProfile } = useAuth();
  const [profile, setProfile] = useState({ displayName: '', phone: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [emailChange, setEmailChange] = useState({ newEmail: '', currentPassword: '' });
  const [emailError, setEmailError] = useState('');
  const [emailNotice, setEmailNotice] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  async function changeEmail(event) {
    event.preventDefault();
    setEmailError('');
    setEmailNotice('');
    const newEmail = emailChange.newEmail.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@texas-trust\.test$/.test(newEmail)) {
      setEmailError('Use an email address ending in @texas-trust.test.');
      return;
    }
    if (newEmail === user?.email) {
      setEmailError('That is already your sign-in email.');
      return;
    }
    if (!emailChange.currentPassword) {
      setEmailError('Enter your current password to confirm this change.');
      return;
    }
    setEmailBusy(true);
    try {
      const result = await apiRequest('/profile/email', {
        token,
        method: 'PATCH',
        body: { newEmail, currentPassword: emailChange.currentPassword }
      });
      updateProfile({ email: result.profile.email });
      setEmailChange({ newEmail: '', currentPassword: '' });
      setEmailNotice(result.message);
    } catch (requestError) {
      setEmailError(requestError.message);
    } finally {
      setEmailBusy(false);
    }
  }

  useEffect(() => {
    apiRequest('/profile', { token })
      .then((result) => setProfile({ displayName: result.profile.displayName || '', phone: result.profile.phone || '' }))
      .catch((requestError) => setProfileError(requestError.message));
  }, [token]);

  async function saveProfile(event) {
    event.preventDefault();
    setProfileError('');
    setProfileNotice('');
    setFieldErrors({});
    setProfileBusy(true);
    try {
      const result = await apiRequest('/profile', { token, method: 'PATCH', body: profile });
      setProfile({ displayName: result.profile.displayName, phone: result.profile.phone });
      updateProfile(result.profile);
      setProfileNotice('Profile updated.');
    } catch (requestError) {
      setProfileError(requestError.message);
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const errors = {};
    if (passwords.newPassword !== passwords.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    if (passwords.newPassword.length < 12 || !/[a-z]/.test(passwords.newPassword) || !/[A-Z]/.test(passwords.newPassword) || !/\d/.test(passwords.newPassword) || !/[^A-Za-z0-9]/.test(passwords.newPassword)) {
      errors.newPassword = 'Use 12+ characters with uppercase, lowercase, a number, and a symbol.';
    }
    setFieldErrors(errors);
    setPasswordError('');
    setPasswordNotice('');
    if (!passwords.currentPassword) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (Object.keys(errors).length) return;

    setPasswordBusy(true);
    try {
      const result = await apiRequest('/profile/password', {
        token,
        method: 'PATCH',
        body: { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword }
      });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordNotice(result.message);
    } catch (requestError) {
      setPasswordError(requestError.message);
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="PERSONAL SETTINGS" title="Profile & settings">Manage your personal details and password.</PageHeading>
      <div className="profile-settings-grid">
        <form className="form-panel form-stack" onSubmit={saveProfile} noValidate>
          <div><p className="eyebrow">PROFILE</p><h2>Personal details</h2></div>
          {profileError && <InlineError>{profileError}</InlineError>}
          {profileNotice && <div className="inline-banner success-banner" role="status">{profileNotice}</div>}
          <label className="field"><span>Display name</span><input autoComplete="name" maxLength={80} value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></label>
          <label className="field"><span>Contact number (optional)</span><input autoComplete="tel" maxLength={32} value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label>
          <label className="field"><span>Sign-in email</span><input value={user?.email || ''} disabled /><small className="field-hint">Change it in the Sign-in email section below.</small></label>
          <button className="button primary" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button>
        </form>

        <form className="form-panel form-stack" onSubmit={changePassword} noValidate>
          <div><p className="eyebrow">PASSWORD</p><h2>Change password</h2></div>
          {passwordError && <InlineError>{passwordError}</InlineError>}
          {passwordNotice && <div className="inline-banner success-banner" role="status">{passwordNotice}</div>}
          <label className="field"><span>Current password</span><PasswordInput autoComplete="current-password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label>
          <label className="field"><span>New password</span><PasswordInput autoComplete="new-password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /><FieldError>{fieldErrors.newPassword}</FieldError></label>
          <label className="field"><span>Confirm new password</span><PasswordInput autoComplete="new-password" value={passwords.confirmPassword} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} /><FieldError>{fieldErrors.confirmPassword}</FieldError></label>
          <button className="button secondary" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Update password'}</button>
        </form>

        <form className="form-panel form-stack" onSubmit={changeEmail} noValidate>
          <div><p className="eyebrow">SIGN-IN</p><h2>Sign-in email</h2></div>
          {emailError && <InlineError>{emailError}</InlineError>}
          {emailNotice && <div className="inline-banner success-banner" role="status">{emailNotice}</div>}
          <label className="field"><span>Current sign-in email</span><input value={user?.email || ''} disabled /></label>
          <label className="field"><span>New sign-in email</span><input type="email" autoComplete="email" placeholder="yourname@texas-trust.test" value={emailChange.newEmail} onChange={(event) => setEmailChange({ ...emailChange, newEmail: event.target.value })} /><small className="field-hint">Must end in @texas-trust.test. Real email addresses are not accepted.</small></label>
          <label className="field"><span>Current password</span><PasswordInput autoComplete="current-password" value={emailChange.currentPassword} onChange={(event) => setEmailChange({ ...emailChange, currentPassword: event.target.value })} /></label>
          <button className="button secondary" disabled={emailBusy}>{emailBusy ? 'Updating…' : 'Update sign-in email'}</button>
        </form>
      </div>
    </>
  );
}