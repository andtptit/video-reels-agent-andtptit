// Extracted out of Pipeline.jsx (used to be defined inline there) so
// ProfileManager.jsx can reuse the exact same "empty = .env default" model picker.
export function ModelSelect({ value, onChange, options, title }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title={title}>
      <option value="">Model mặc định (.env)</option>
      {options.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}
