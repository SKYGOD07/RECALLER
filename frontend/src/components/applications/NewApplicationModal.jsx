import { useState, useRef } from 'react'
import { api } from '@/api'
import { createNewApplication } from '@/store/console'
import { applicationPath, navigate } from '@/lib/router'
import {
  Sparkles,
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  ShieldCheck,
  Zap,
} from 'lucide-react'

const SEGMENTS = [
  { id: 'EV_2W', label: 'EV 2-Wheeler (Scooter / Bike)' },
  { id: 'EV_3W_PASSENGER', label: 'EV 3-Wheeler Passenger (E-Rickshaw / Auto)' },
  { id: 'EV_3W_CARGO', label: 'EV 3-Wheeler Cargo (Delivery / Loader)' },
]

const BRANCHES = [
  'Delhi — Karol Bagh',
  'Pune — Hadapsar',
  'Nagpur — Sitabuldi',
  'Lucknow — Aminabad',
  'Jaipur — Vaishali Nagar',
  'Coimbatore — Gandhipuram',
  'Hyderabad — Malakpet',
  'Patna — Kankarbagh',
]

export default function NewApplicationModal({ isOpen, onClose }) {
  const fileInputRef = useRef(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [scanError, setScanError] = useState(null)

  const [formData, setFormData] = useState({
    borrower_name: '',
    segment: 'EV_2W',
    loan_amount: '95000',
    tenure_months: '36',
    declared_monthly_income: '32000',
    branch: 'Delhi — Karol Bagh',
    dealer: 'Volt Mobility, Karol Bagh',
    occupation: 'Ride-hailing driver',
  })

  const [attachDoc, setAttachDoc] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  if (!isOpen) return null

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setScanResult(null)
    setScanError(null)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file) {
      setSelectedFile(file)
      setScanResult(null)
      setScanError(null)
    }
  }

  const handleScanWithHermes = async () => {
    if (!selectedFile) return
    setScanning(true)
    setScanError(null)
    try {
      const res = await api.extractApplicationDraft(selectedFile)
      if (res && res.extracted_fields) {
        const fields = res.extracted_fields
        setScanResult(res)
        setFormData((prev) => ({
          ...prev,
          borrower_name: fields.borrower_name || prev.borrower_name,
          segment: fields.segment || prev.segment,
          loan_amount: String(fields.loan_amount || prev.loan_amount),
          tenure_months: String(fields.tenure_months || prev.tenure_months),
          declared_monthly_income: String(fields.declared_monthly_income || prev.declared_monthly_income),
          branch: fields.branch || prev.branch,
          dealer: fields.dealer || prev.dealer,
          occupation: fields.occupation || prev.occupation,
        }))
      } else {
        setScanError('No applicant fields could be extracted from this document.')
      }
    } catch (err) {
      setScanError(err.message || 'Hermes OCR extraction failed. You can still fill the fields manually.')
    } finally {
      setScanning(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.borrower_name.trim()) {
      setSubmitError('Borrower name is required')
      return
    }
    setSubmitting(true)
    setSubmitError(null)

    try {
      const payload = {
        borrower_name: formData.borrower_name.trim(),
        segment: formData.segment,
        loan_amount: Number(formData.loan_amount) || 95000,
        tenure_months: Number(formData.tenure_months) || 36,
        declared_monthly_income: Number(formData.declared_monthly_income) || 32000,
        branch: formData.branch,
        dealer: formData.dealer,
        occupation: formData.occupation,
        officer: 'Loan Officer Console',
      }

      const docType = scanResult?.extracted_fields?.detected_doc_type || 'AADHAAR'
      const app = await createNewApplication(payload, attachDoc ? selectedFile : null, docType)

      onClose()
      navigate(applicationPath(app.id))
    } catch (err) {
      setSubmitError(err.message || 'Failed to create application.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="modal-badge">
              <Sparkles size={13} className="text-emerald-400" />
              <span>Hermes OCR Document Intake</span>
            </div>
            <h2 className="modal-title">New Loan Application</h2>
            <p className="modal-sub">
              Upload an applicant document for Hermes OCR autofill, or enter loan terms manually.
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </header>

        <div className="modal-body">
          {/* Hermes OCR Dropzone Card */}
          <section className="ocr-intake-card">
            <div className="ocr-intake-header">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Document Scanner (Aadhaar / PAN / Invoice / Statement)</h3>
              </div>
              <span className="ocr-skill-tag">Hermes Agent OCR</span>
            </div>

            <div
              className={`ocr-dropzone ${selectedFile ? 'has-file' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt"
                className="hidden"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />

              <UploadCloud size={24} className="ocr-upload-icon text-zinc-400" />
              <div className="ocr-dropzone-text">
                {selectedFile ? (
                  <p className="font-medium text-white">{selectedFile.name} <span className="text-xs text-zinc-400">({Math.round(selectedFile.size / 1024)} KB)</span></p>
                ) : (
                  <>
                    <p className="font-medium text-white">Click or drag & drop borrower document</p>
                    <p className="text-xs text-zinc-400">Supports PDF, JPEG, PNG, or TXT (up to 20MB)</p>
                  </>
                )}
              </div>
            </div>

            {selectedFile && (
              <div className="ocr-action-bar">
                <button
                  type="button"
                  className="btn-scan-hermes"
                  disabled={scanning}
                  onClick={handleScanWithHermes}
                >
                  {scanning ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      <span>Scanning with Hermes OCR...</span>
                    </>
                  ) : (
                    <>
                      <Zap size={15} />
                      <span>Scan & Autofill with Hermes OCR</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {scanResult && (
              <div className="ocr-success-box">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                    <CheckCircle2 size={15} />
                    <span>Fields Extracted by Hermes OCR</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="ocr-pill ocr-pill--doc">
                      {scanResult.extracted_fields?.detected_doc_type || 'DOCUMENT'}
                    </span>
                    <span className="ocr-pill ocr-pill--conf">
                      {Math.round((scanResult.extracted_fields?.confidence || 0.9) * 100)}% Confidence
                    </span>
                  </div>
                </div>
                {scanResult.extracted_fields?.snippet && (
                  <p className="ocr-snippet-quote">
                    “{scanResult.extracted_fields.snippet}”
                  </p>
                )}
              </div>
            )}

            {scanError && (
              <div className="ocr-error-box">
                <AlertCircle size={15} />
                <span>{scanError}</span>
              </div>
            )}
          </section>

          {/* Form Fields */}
          <form id="new-application-form" onSubmit={handleSubmit} className="modal-form-grid">
            <div className="form-group col-span-2">
              <label className="form-label" htmlFor="borrower_name">
                Borrower Full Name <span className="text-red-400">*</span>
              </label>
              <input
                id="borrower_name"
                type="text"
                className="form-input"
                required
                placeholder="e.g. Ramesh Kumar"
                value={formData.borrower_name}
                onChange={(e) => setFormData({ ...formData, borrower_name: e.target.value })}
              />
            </div>

            <div className="form-group col-span-2">
              <label className="form-label" htmlFor="segment">
                Asset / Vehicle Segment
              </label>
              <select
                id="segment"
                className="form-select"
                value={formData.segment}
                onChange={(e) => setFormData({ ...formData, segment: e.target.value })}
              >
                {SEGMENTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="loan_amount">
                Requested Amount (₹)
              </label>
              <input
                id="loan_amount"
                type="number"
                min="10000"
                step="1000"
                className="form-input mono"
                value={formData.loan_amount}
                onChange={(e) => setFormData({ ...formData, loan_amount: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="tenure_months">
                Tenure (Months)
              </label>
              <input
                id="tenure_months"
                type="number"
                min="6"
                max="84"
                step="6"
                className="form-input mono"
                value={formData.tenure_months}
                onChange={(e) => setFormData({ ...formData, tenure_months: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="declared_monthly_income">
                Declared Monthly Income (₹)
              </label>
              <input
                id="declared_monthly_income"
                type="number"
                min="5000"
                step="1000"
                className="form-input mono"
                value={formData.declared_monthly_income}
                onChange={(e) => setFormData({ ...formData, declared_monthly_income: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="occupation">
                Occupation
              </label>
              <input
                id="occupation"
                type="text"
                className="form-input"
                value={formData.occupation}
                onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="branch">
                Branch
              </label>
              <select
                id="branch"
                className="form-select"
                value={formData.branch}
                onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
              >
                {BRANCHES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="dealer">
                Dealer / Showroom
              </label>
              <input
                id="dealer"
                type="text"
                className="form-input"
                value={formData.dealer}
                onChange={(e) => setFormData({ ...formData, dealer: e.target.value })}
              />
            </div>

            {selectedFile && (
              <div className="col-span-2 flex items-center gap-2 pt-2">
                <input
                  id="attach_doc"
                  type="checkbox"
                  className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                  checked={attachDoc}
                  onChange={(e) => setAttachDoc(e.target.checked)}
                />
                <label htmlFor="attach_doc" className="text-xs text-zinc-300">
                  Attach uploaded document ({selectedFile.name}) to application evidence set
                </label>
              </div>
            )}

            {submitError && (
              <div className="col-span-2 ocr-error-box">
                <AlertCircle size={15} />
                <span>{submitError}</span>
              </div>
            )}
          </form>
        </div>

        <footer className="modal-foot">
          <button type="button" className="btn-modal-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="submit"
            form="new-application-form"
            className="btn-modal-primary"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Creating application...</span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                <span>Create & Open Underwriting</span>
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
