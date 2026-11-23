export default function BrandLockup({ compact = false, inverse = false }) {
  return (
    <span className={`brand-lockup${compact ? ' compact' : ''}${inverse ? ' inverse' : ''}`} aria-label="Texas Legal Trust Fund Bank concept prototype">
      <img className="brand-logo" src="/texas-legal-trust-mark.svg" alt="" />
      <span className="brand-copy">
        <span className="brand-name">{compact ? 'Texas Legal Trust' : 'Texas Legal Trust Fund Bank'}</span>
        <span className="brand-descriptor">{compact ? 'FUND BANK · CONCEPT' : 'CONCEPT PROTOTYPE'}</span>
      </span>
    </span>
  );
}