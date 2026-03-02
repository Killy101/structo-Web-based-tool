"use client";
import React, { useState, useRef } from "react";

interface ProfileModalProps {
  user: any;
  onClose: () => void;
  dark: boolean;
}

export default function ProfileModal({ user, onClose, dark }: ProfileModalProps) {
  const [tab, setTab] = useState<"info" | "password">("info");

  const [firstName, setFirstName] = useState(user?.firstName ?? "");
  const [lastName, setLastName] = useState(user?.lastName ?? "");
  const [contact, setContact] = useState(user?.contact ?? "");
  const [avatar, setAvatar] = useState<string | null>(user?.avatarUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState("");

  const initials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`;

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSaveInfo() {
    setSaveError("");
    setSaving(true);
    try {
      // PATCH /api/user/profile — send { firstName, lastName, contact, avatar }
      await new Promise((r) => setTimeout(r, 600));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    setPwError("");
    if (!currentPw || !newPw || !confirmPw) { setPwError("All fields are required."); return; }
    if (newPw.length < 8) { setPwError("New password must be at least 8 characters."); return; }
    if (newPw !== confirmPw) { setPwError("Passwords do not match."); return; }
    setPwSaving(true);
    try {
      // POST /api/user/change-password — send { currentPw, newPw }
      await new Promise((r) => setTimeout(r, 600));
      setPwSuccess(true);
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setTimeout(() => setPwSuccess(false), 3000);
    } catch {
      setPwError("Failed to change password. Please try again.");
    } finally {
      setPwSaving(false);
    }
  }

  const pwStrength = (() => {
    if (!newPw) return 0;
    let s = 0;
    if (newPw.length >= 8) s++;
    if (newPw.length >= 12) s++;
    if (/[A-Z]/.test(newPw) && /[0-9]/.test(newPw)) s++;
    if (/[^A-Za-z0-9]/.test(newPw)) s++;
    return s;
  })();
  const pwStrengthLabel = ["", "Weak", "Fair", "Good", "Strong"][pwStrength];
  const pwStrengthColor = ["", "bg-red-500", "bg-amber-500", "bg-yellow-400", "bg-emerald-500"][pwStrength];

  const inputCls = dark
    ? "w-full px-3.5 py-2.5 rounded-xl text-sm text-white bg-slate-800/70 border border-slate-700/60 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#1a56f0]/60 focus:border-[#1a56f0] transition-all"
    : "w-full px-3.5 py-2.5 rounded-xl text-sm text-slate-900 bg-white border border-slate-300/90 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1a56f0]/30 focus:border-[#1a56f0] transition-all";
  const readonlyCls = dark
    ? "px-3.5 py-2.5 rounded-xl bg-slate-800/40 border border-slate-700/40 text-slate-500 text-sm"
    : "px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-sm";

  const EyeIcon = ({ show }: { show: boolean }) => show ? (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-center sm:p-4">
      <div className={`absolute inset-0 backdrop-blur-sm ${dark ? "bg-black/60" : "bg-slate-900/30"}`} onClick={onClose} />

      <div className={`relative z-10 w-full h-[100dvh] sm:h-auto sm:max-w-md max-h-[100dvh] sm:max-h-[90vh] flex flex-col rounded-none sm:rounded-2xl overflow-hidden border-0 sm:border ${dark ? "bg-[#1e293b] sm:border-slate-700/80 sm:shadow-2xl sm:shadow-black/60" : "bg-white sm:border-slate-200 sm:shadow-2xl sm:shadow-slate-900/10"}`}>

        {/* header */}
        <div className={`flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b flex-shrink-0 ${dark ? "border-slate-700/60" : "border-slate-200"}`}>
          <div>
            <h2 className={`font-semibold text-base ${dark ? "text-white" : "text-slate-900"}`}>My Profile</h2>
            <p className={`text-xs mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>Manage your account</p>
          </div>
          <button onClick={onClose} className={`rounded-lg p-1.5 transition-all ${dark ? "text-slate-500 hover:text-slate-200 hover:bg-slate-700/60" : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* tabs */}
        <div className={`flex flex-shrink-0 border-b ${dark ? "border-slate-700/60" : "border-slate-200"}`}>
          {(["info", "password"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-xs sm:text-sm font-medium transition-all border-b-2 ${
                tab === t
                  ? `${dark ? "text-white" : "text-slate-900"} border-[#1a56f0]`
                  : `${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"} border-transparent`
              }`}
            >
              {t === "info" ? "Personal Info" : "Change Password"}
            </button>
          ))}
        </div>

        {/* personal info tab */}
        {tab === "info" && (
          <div className="overflow-y-auto scrollbar-none flex-1 p-4 sm:p-6 space-y-4">

            {/* avatar */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative group cursor-pointer" onClick={() => fileRef.current?.click()}>
                {avatar ? (
                  <img src={avatar} alt="Profile" className="w-20 h-20 rounded-2xl object-cover shadow-lg ring-2 ring-slate-700" />
                ) : (
                  <div className="w-20 h-20 bg-gradient-to-br from-[#1a56f0] to-purple-600 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-blue-900/30">
                    {initials}
                  </div>
                )}
                <div className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-1 transition-opacity duration-200">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-white text-[10px] font-medium">Change</span>
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              <p className="text-slate-500 text-[11px]">Click to change photo</p>
            </div>

            {/* user id */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">User ID</label>
              <div className={`${readonlyCls} font-mono break-all`}>{user?.id ?? "—"}</div>
            </div>

            {/* name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">First Name</label>
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" className={inputCls} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Last Name</label>
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" className={inputCls} />
              </div>
            </div>

            {/* email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Email Address</label>
              <div className={`${readonlyCls} flex items-center gap-2 min-w-0`}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                </svg>
                <span className="break-all">{user?.email ?? "—"}</span>
              </div>
            </div>

            {/* contact */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Contact Number</label>
              <input type="tel" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+1 (555) 000-0000" className={inputCls} />
            </div>

            {saveError && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {saveError}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
              <button
                onClick={handleSaveInfo}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#1a56f0] text-white hover:bg-[#1a56f0]/90 hover:shadow-lg hover:shadow-blue-900/30 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                {saving ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>Saving...</>
                ) : saveSuccess ? (
                  <><svg className="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Saved!</>
                ) : "Save Changes"}
              </button>
              <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-700/60 text-slate-300 border border-slate-600/60 hover:bg-slate-700 hover:text-white transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* change password tab */}
        {tab === "password" && (
          <div className="overflow-y-auto scrollbar-none flex-1 p-4 sm:p-6 space-y-4">

            {/* current password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Current Password</label>
              <div className="relative">
                <input type={showCurrentPw ? "text" : "password"} value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Enter current password" className={`${inputCls} pr-10`} />
                <button type="button" onClick={() => setShowCurrentPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  <EyeIcon show={showCurrentPw} />
                </button>
              </div>
            </div>

            {/* new password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">New Password</label>
              <div className="relative">
                <input type={showNewPw ? "text" : "password"} value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Min. 8 characters" className={`${inputCls} pr-10`} />
                <button type="button" onClick={() => setShowNewPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  <EyeIcon show={showNewPw} />
                </button>
              </div>
              {newPw && (
                <div className="space-y-1 mt-0.5">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((l) => (
                      <div key={l} className={`h-1 flex-1 rounded-full transition-all duration-300 ${l <= pwStrength ? pwStrengthColor : "bg-slate-700"}`} />
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500">{pwStrengthLabel} password</p>
                </div>
              )}
            </div>

            {/* confirm password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Confirm New Password</label>
              <div className="relative">
                <input
                  type={showConfirmPw ? "text" : "password"}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Repeat new password"
                  className={`${inputCls} pr-10 ${confirmPw && confirmPw !== newPw ? "border-red-500/60 focus:ring-red-500/40 focus:border-red-500" : ""}`}
                />
                <button type="button" onClick={() => setShowConfirmPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                  <EyeIcon show={showConfirmPw} />
                </button>
              </div>
              {confirmPw && confirmPw !== newPw && (
                <p className="text-[11px] text-red-400 mt-0.5">Passwords do not match</p>
              )}
            </div>

            {pwError && (
              <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {pwError}
              </div>
            )}

            {pwSuccess && (
              <div className="flex items-center gap-2 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Password changed successfully!
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
              <button
                onClick={handleChangePassword}
                disabled={pwSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#1a56f0] text-white hover:bg-[#1a56f0]/90 hover:shadow-lg hover:shadow-blue-900/30 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                {pwSaving ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>Updating...</>
                ) : "Update Password"}
              </button>
              <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-700/60 text-slate-300 border border-slate-600/60 hover:bg-slate-700 hover:text-white transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}