"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type AttendanceEntry = {
	name: string;
	deviceId: string;
	timestamp: string; // ISO string
};

type Mode = "scanner" | "self";

const ATTENDANCE_STORAGE_KEY = "attendance:list";
const DEVICE_ID_STORAGE_KEY = "attendance:deviceId";
const SELF_ATTEMPT_KEY = "attendance:self:attempted";
const ORGANIZER_PIN = process.env.NEXT_PUBLIC_ORG_PIN ?? "1234";

function getOrCreateDeviceId(): string {
	if (typeof window === "undefined") return "";
	let deviceId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
	if (!deviceId) {
		try {
			deviceId = crypto.randomUUID();
		} catch {
			deviceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		}
		localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
	}
	return deviceId;
}

function readAttendance(): AttendanceEntry[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = localStorage.getItem(ATTENDANCE_STORAGE_KEY);
		return raw ? (JSON.parse(raw) as AttendanceEntry[]) : [];
	} catch {
		return [];
	}
}

function writeAttendance(entries: AttendanceEntry[]) {
	if (typeof window === "undefined") return;
	localStorage.setItem(ATTENDANCE_STORAGE_KEY, JSON.stringify(entries));
}

export default function HomePage() {
	const [mode, setMode] = useState<Mode>("scanner");
	const [entries, setEntries] = useState<AttendanceEntry[]>([]);
	const [manualName, setManualName] = useState("");
	const [scanError, setScanError] = useState<string | null>(null);
	const [infoMessage, setInfoMessage] = useState<string | null>(null);
	const [justScanned, setJustScanned] = useState(false);
	const [selfAttempted, setSelfAttempted] = useState(false);
	const [organizerUnlocked, setOrganizerUnlocked] = useState(false);
	const [pinInput, setPinInput] = useState("");
	const [unlockError, setUnlockError] = useState<string | null>(null);
	const deviceIdRef = useRef<string>("");

	useEffect(() => {
		deviceIdRef.current = getOrCreateDeviceId();
		setEntries(readAttendance());
		setSelfAttempted(localStorage.getItem(SELF_ATTEMPT_KEY) === "true");
	}, []);

	useEffect(() => {
		// Force self mode when organizer lock is engaged
		if (!organizerUnlocked && mode === "scanner") {
			setMode("self");
		}
	}, [organizerUnlocked, mode]);

	const addEntry = useCallback((nameRaw: string) => {
		const name = nameRaw.trim();
		if (!name) return;
 
 		// Prevent duplicates by name (case-insensitive)
 		const exists = entries.some(
 			(e) => e.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0
 		);
 		if (exists) return;
 
 		const newEntry: AttendanceEntry = {
 			name,
 			deviceId: deviceIdRef.current,
 			timestamp: new Date().toISOString(),
 		};
 		const updated = [newEntry, ...entries];
 		setEntries(updated);
 		writeAttendance(updated);
 	}, [entries]);

	const handleDecode = useCallback(
		(result: string) => {
			if (justScanned) return; // debounce burst scans
			setJustScanned(true);
			setTimeout(() => setJustScanned(false), 1200);

			setScanError(null);
			setInfoMessage(null);

			if (mode === "self") {
				if (selfAttempted) {
					setScanError("You have already checked in from this device.");
					return;
				}
				// Do NOT save to attendance in self mode; only mark attempt and show success
				localStorage.setItem(SELF_ATTEMPT_KEY, "true");
				setSelfAttempted(true);
				setInfoMessage("Check-in recorded on this device. Please show your QR to the organizer.");
				return;
			}

			// scanner mode: only organizers may save
			if (!organizerUnlocked) {
				setScanError("Organizer lock is enabled. Unlock to save attendance.");
				return;
			}
			// scanner mode can add many (with organizer unlocked)
			addEntry(result);
		},
		[addEntry, justScanned, mode, selfAttempted, organizerUnlocked]
	);

	const handleManualAdd = useCallback(() => {
		if (!manualName.trim()) return;
		if (!organizerUnlocked) {
			setScanError("Organizer lock is enabled. Unlock to save attendance.");
			return;
		}
		addEntry(manualName);
		setManualName("");
	}, [addEntry, manualName, organizerUnlocked]);

	const exportExcel = useCallback(() => {
 		const worksheet = XLSX.utils.json_to_sheet(
 			entries.map((e) => ({
 				Name: e.name,
 				Device: e.deviceId,
 				Time: new Date(e.timestamp).toLocaleString(),
 			}))
 		);
 		const workbook = XLSX.utils.book_new();
 		XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
 		XLSX.writeFile(workbook, "attendance.xlsx");
 	}, [entries]);

	const exportPdf = useCallback(() => {
 		const doc = new jsPDF();
 		doc.text("Attendance", 14, 16);
 		autoTable(doc, {
 			head: [["#", "Name", "Device", "Time"]],
 			body: entries.map((e, idx) => [
 				String(idx + 1),
 				e.name,
 				e.deviceId,
 				new Date(e.timestamp).toLocaleString(),
 			]),
 			startY: 22,
 		});
 		doc.save("attendance.pdf");
 	}, [entries]);

	const clearAll = useCallback(() => {
 		setEntries([]);
 		writeAttendance([]);
 	}, []);

	const sortedEntries = useMemo(
 		() => [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
 		[entries]
 	);

	return (
 		<div style={{ maxWidth: 920, margin: "0 auto", padding: "24px" }}>
 			<h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>QR Attendance</h1>
 			<p style={{ color: "#555", marginBottom: 16 }}>
				Save names in localStorage, limit one self check-in per device, export as Excel or PDF. Students can generate their QR at <a href="/student" style={{ color: "#2563eb" }}>/student</a>.
			</p>

			<div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, padding: 12, border: "1px solid #e5e7eb", borderRadius: 12 }}>
				<span style={{ fontWeight: 600 }}>Organizer lock:</span>
				{organizerUnlocked ? (
					<span style={{ color: "#059669" }}>Unlocked</span>
				) : (
					<span style={{ color: "#b91c1c" }}>Locked</span>
				)}
				{!organizerUnlocked && (
					<>
						<input
							type="password"
							placeholder="Enter PIN"
							value={pinInput}
							onChange={(e) => setPinInput(e.target.value)}
							style={{ flex: 1, padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8 }}
						/>
						<button
							onClick={() => {
								if (pinInput === ORGANIZER_PIN) {
									setOrganizerUnlocked(true);
									setUnlockError(null);
								} else {
									setUnlockError("Invalid PIN");
								}
							}}
							style={{ padding: "8px 12px", background: "#111827", color: "white", border: 0, borderRadius: 8, cursor: "pointer" }}
						>
							Unlock
						</button>
						{unlockError && <span style={{ color: "#b91c1c" }}>{unlockError}</span>}
					</>
				)}
			</div>

 			<div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
 				<label style={{ display: "flex", alignItems: "center", gap: 6 }}>
					<input
						type="radio"
						name="mode"
						value="scanner"
						checked={mode === "scanner"}
						disabled={!organizerUnlocked}
						onChange={() => setMode("scanner")}
					/>
					<span>Scanner mode (organizer)</span>
				</label>
 				<label style={{ display: "flex", alignItems: "center", gap: 6 }}>
 					<input
 						type="radio"
 						name="mode"
 						value="self"
 						checked={mode === "self"}
 						onChange={() => setMode("self")}
 					/>
 					<span>Self check-in (one attempt per device)</span>
 				</label>
 			</div>

 			{mode === "self" && selfAttempted && (
 				<div style={{ marginBottom: 12, color: "#2563eb" }}>
 					You have already submitted attendance from this device.
 				</div>
 			)}

			{infoMessage && (
				<div style={{ marginBottom: 12, color: "#059669" }}>{infoMessage}</div>
			)}

 			<div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
 				<div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
 					<h3 style={{ margin: 0, marginBottom: 8, fontSize: 18 }}>Scan QR</h3>
 					<div style={{ overflow: "hidden", borderRadius: 8 }}>
 						<Scanner
							onScan={(codes) => {
								const value = Array.isArray(codes) && codes.length > 0 ? codes[0].rawValue : "";
								if (value) handleDecode(value);
							}}
							onError={(err: unknown) => {
								const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Camera error";
								setScanError(String(message));
							}}
							constraints={{ facingMode: "environment" }}
							styles={{
								container: { width: "100%" },
								video: { width: "100%", borderRadius: 8 },
							}}
						/>
 					</div>
 					{scanError && (
 						<div style={{ color: "#b91c1c", marginTop: 8 }}>{scanError}</div>
 					)}
 				</div>

 				<div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
 					<h3 style={{ margin: 0, marginBottom: 8, fontSize: 18 }}>Manual entry</h3>
 					<div style={{ display: "flex", gap: 8 }}>
 						<input
 							type="text"
 							placeholder="Full name"
 							value={manualName}
 							onChange={(e) => setManualName(e.target.value)}
 							style={{ flex: 1, padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8 }}
 						/>
 						<button
							onClick={handleManualAdd}
							disabled={!organizerUnlocked}
							style={{
								padding: "10px 14px",
								background: (!organizerUnlocked) ? "#9ca3af" : "#111827",
								color: "white",
								border: 0,
								borderRadius: 8,
								cursor: (!organizerUnlocked) ? "not-allowed" : "pointer",
							}}
						>
							Add
						</button>
 					</div>
 				</div>
 			</div>

 			<div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
 				<button onClick={exportExcel} disabled={!organizerUnlocked} style={{ padding: "10px 14px", background: organizerUnlocked ? "#2563eb" : "#9ca3af", color: "white", border: 0, borderRadius: 8, cursor: organizerUnlocked ? "pointer" : "not-allowed" }}>
 					Export Excel
 				</button>
 				<button onClick={exportPdf} disabled={!organizerUnlocked} style={{ padding: "10px 14px", background: organizerUnlocked ? "#059669" : "#9ca3af", color: "white", border: 0, borderRadius: 8, cursor: organizerUnlocked ? "pointer" : "not-allowed" }}>
 					Export PDF
 				</button>
 				<button onClick={clearAll} disabled={!organizerUnlocked} style={{ padding: "10px 14px", background: organizerUnlocked ? "#ef4444" : "#9ca3af", color: "white", border: 0, borderRadius: 8, cursor: organizerUnlocked ? "pointer" : "not-allowed" }}>
 					Clear List
 				</button>
 			</div>

 			<div style={{ marginTop: 20 }}>
 				<h3 style={{ margin: 0, marginBottom: 8, fontSize: 18 }}>Attendance ({sortedEntries.length})</h3>
 				<div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 12 }}>
 					<table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
 						<thead>
 							<tr style={{ background: "#f9fafb", textAlign: "left" }}>
 								<th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>#</th>
 								<th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>Name</th>
 								<th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>Device</th>
 								<th style={{ padding: "10px 12px", borderBottom: "1px solid #e5e7eb" }}>Time</th>
 							</tr>
 						</thead>
 						<tbody>
 							{sortedEntries.map((e, idx) => (
 								<tr key={`${e.name}-${e.timestamp}`}>
 									<td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>{idx + 1}</td>
 									<td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>{e.name}</td>
 									<td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{e.deviceId}</td>
 									<td style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>{new Date(e.timestamp).toLocaleString()}</td>
 								</tr>
 							))}
 							{sortedEntries.length === 0 && (
 								<tr>
 									<td colSpan={4} style={{ padding: "12px", color: "#6b7280" }}>No entries yet.</td>
 								</tr>
 							)}
 						</tbody>
 					</table>
 				</div>
 			</div>
 		</div>
 	);
}


