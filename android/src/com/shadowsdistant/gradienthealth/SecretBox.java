package com.shadowsdistant.gradienthealth;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.Key;
import java.security.KeyStore;
import java.security.UnrecoverableKeyException;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secrets at rest (the Anthropic API key, see Bridge.saveSecret): AES-256-GCM with a key the
 * Android Keystore makes and keeps (alias gh-secrets-1). The key never leaves the Keystore, so the
 * app's files, a backup or a copy of its storage hold nothing that opens the value. A stored value
 * is "v2:&lt;base64 IV&gt;:&lt;base64 ciphertext with its 128-bit tag&gt;"; the Keystore picks a
 * fresh IV for every value. Nothing here logs anything, and every failure is an exception the
 * caller fails closed on (the value goes, and the app asks for the key again).
 */
final class SecretBox {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "gh-secrets-1";
    private static final String VERSION = "v2";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;
    private static final int IV_BYTES = 12;

    private SecretBox() {
    }

    /** Whether a stored value is sealed (else it's plain text from before 1.6). */
    static boolean isSealed(String stored) {
        return stored != null && stored.startsWith(VERSION + ":");
    }

    /** The value sealed for storage, under the app's Keystore key (made the first time). */
    static String seal(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        try {
            cipher.init(Cipher.ENCRYPT_MODE, key(true));
        } catch (InvalidKeyException e) {
            // The Keystore turned its own key down (keys can be lost on a system update or a reset
            // of the secure hardware). Nothing sealed with it can be opened again, so a new key
            // takes its place rather than the app never storing a key again.
            forget();
            cipher.init(Cipher.ENCRYPT_MODE, key(true));
        }
        byte[] sealed = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != IV_BYTES) {
            throw new IllegalStateException("unexpected IV");
        }
        return VERSION + ":" + Base64.encodeToString(iv, Base64.NO_WRAP) + ":"
                + Base64.encodeToString(sealed, Base64.NO_WRAP);
    }

    /**
     * The value back. Throws if it isn't one of ours, was changed (the tag doesn't match), or its key
     * is gone (a restore onto another phone, or the app's data cleared).
     */
    static String open(String stored) throws Exception {
        String[] parts = stored == null ? new String[0] : stored.split(":", -1);
        if (parts.length != 3 || !VERSION.equals(parts[0])) {
            throw new IllegalArgumentException("not a sealed value");
        }
        byte[] iv = Base64.decode(parts[1], Base64.NO_WRAP);
        byte[] sealed = Base64.decode(parts[2], Base64.NO_WRAP);
        if (iv.length != IV_BYTES || sealed.length < TAG_BITS / 8) {
            throw new IllegalArgumentException("not a sealed value");
        }
        SecretKey key = key(false);
        if (key == null) {
            throw new IllegalStateException("no key");
        }
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
        return new String(cipher.doFinal(sealed), StandardCharsets.UTF_8);
    }

    /** The app's key from the Keystore; made (AES-256, GCM only, a fresh IV each time) if asked to. */
    private static synchronized SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        Key key;
        try {
            key = store.getKey(ALIAS, null);
        } catch (UnrecoverableKeyException e) {
            if (!create) {
                throw e;
            }
            store.deleteEntry(ALIAS); // lost, as above: a new one replaces it
            key = null;
        }
        if (key instanceof SecretKey) {
            return (SecretKey) key;
        }
        if (!create) {
            return null;
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    /** Deletes the app's Keystore key: whatever it sealed can't be opened after this. */
    private static synchronized void forget() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        store.deleteEntry(ALIAS);
    }
}
