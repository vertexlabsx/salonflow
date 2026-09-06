import { Injectable } from "@angular/core";
import { Capacitor, registerPlugin } from "@capacitor/core";

export type AttendanceInstallationIdentity = {
  installationId: string;
  publicKeySpkiBase64: string;
  algorithm: string;
  biometricLabel?: string;
  hardwareBacked: boolean;
  verificationCapability: "biometric_or_device_credential";
  attestationStatus: "unverified" | "attested";
  attestationChain?: string;
};

export type NativeAttendanceLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  mockLocation: boolean;
  integrityVerdict?: string;
  integrityToken?: string;
}

export type AttendanceUserVerification = {
  signatureBase64: string;
  algorithm: string;
  userVerified: boolean;
  verifiedAt: string;
};

export type IntegrityTokenResult = {
  integrityToken: string;
  integrityVerdict: string;
};

export type DeviceRiskSignals = {
  rooted: boolean;
  hookDetected: boolean;
  tampered: boolean;
  emulator: boolean;
};

type AttendanceBiometricPlugin = {
  getInstallationIdentity(): Promise<AttendanceInstallationIdentity>;
  capturePreciseLocation(options: { maxAccuracyMeters: number; timeoutMs: number }): Promise<NativeAttendanceLocation>;
  verifyUserAndSign(options: { signingPayloadBase64: string; reason: string }): Promise<AttendanceUserVerification>;
  requestIntegrityToken(options: { nonce: string }): Promise<IntegrityTokenResult>;
  getDeviceRiskSignals(): Promise<DeviceRiskSignals>;
};

const AttendanceBiometric = registerPlugin<AttendanceBiometricPlugin>("AttendanceBiometric");

@Injectable({ providedIn: "root" })
export class AttendanceBiometricService {
  isSupportedPlatform(): boolean { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"; }

  unsupportedMessage(): string {
    return "Secure attendance is available only in the Android Solastio app. This punch was not recorded or queued.";
  }

  installationIdentity(): Promise<AttendanceInstallationIdentity> {
    this.assertSupported();
    return AttendanceBiometric.getInstallationIdentity();
  }

  preciseLocation(maxAccuracyMeters: number): Promise<NativeAttendanceLocation> {
    this.assertSupported();
    return AttendanceBiometric.capturePreciseLocation({ maxAccuracyMeters, timeoutMs: 20_000 });
  }

  verifyUserAndSign(signingPayloadBase64: string, reason: string): Promise<AttendanceUserVerification> {
    this.assertSupported();
    return AttendanceBiometric.verifyUserAndSign({ signingPayloadBase64, reason });
  }

  requestIntegrityToken(nonce: string): Promise<IntegrityTokenResult> {
    this.assertSupported();
    return AttendanceBiometric.requestIntegrityToken({ nonce });
  }

  getDeviceRiskSignals(): Promise<DeviceRiskSignals> {
    this.assertSupported();
    return AttendanceBiometric.getDeviceRiskSignals();
  }

  private assertSupported(): void {
    if (!this.isSupportedPlatform()) throw new Error(this.unsupportedMessage());
  }
}
