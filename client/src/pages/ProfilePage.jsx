import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { FieldError, InlineError, PageHeading } from '../components/BankingUI.jsx';
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
          <label className="field"><span>Sign-in email</span><input value={user?.email || ''} disabled /><small className="field-hint">Your sign-in email cannot be changed here.</small></label>
          <button className="button primary" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save profile'}</button>
        </form>

        <form className="form-panel form-stack" onSubmit={changePassword} noValidate>
          <div><p className="eyebrow">PASSWORD</p><h2>Change password</h2></div>
          {passwordError && <InlineError>{passwordError}</InlineError>}
          {passwordNotice && <div className="inline-banner success-banner" role="status">{passwordNotice}</div>}
          <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label>
          <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /><FieldError>{fieldErrors.newPassword}</FieldError></label>
          <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={passwords.confirmPassword} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} /><FieldError>{fieldErrors.confirmPassword}</FieldError></label>
          <button className="button secondary" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : 'Update password'}</button>
        </form>
      </div>
    </>
  );
}