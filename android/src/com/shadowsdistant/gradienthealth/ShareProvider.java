package com.shadowsdistant.gradienthealth;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Serves the pictures the app shares (a badge's card) to the app picked on the share sheet, as
 * content://com.shadowsdistant.gradienthealth.files/shared/badge-<ms>.png.
 *
 * A minimal stand-in for AndroidX's FileProvider, which the Gradle-free build doesn't have. It's
 * not exported: another app can only open a file through the one-time read grant that comes with
 * the share intent (grantUriPermissions). It only reads, only PNG files directly inside
 * cacheDir/shared/, and only names made of lowercase letters, digits and dashes, so no path can
 * reach anything else (the canonical path is checked too, against links and dots). MainActivity
 * writes the files and clears out old ones.
 */
public final class ShareProvider extends ContentProvider {
    static final String AUTHORITY = "com.shadowsdistant.gradienthealth.files";
    static final String DIR = "shared";
    private static final Pattern PATH = Pattern.compile("^/shared/[a-z0-9-]{1,40}\\.png$");
    private static final String[] COLUMNS = {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};

    /** The address another app opens a shared file by. */
    static Uri uriFor(File file) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY).path("/" + DIR + "/" + file.getName()).build();
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    /** Like FileProvider: refuses to run exported, or without per-URI grants. */
    @Override
    public void attachInfo(Context context, ProviderInfo info) {
        super.attachInfo(context, info);
        if (info.exported) {
            throw new SecurityException("ShareProvider must not be exported");
        }
        if (!info.grantUriPermissions) {
            throw new SecurityException("ShareProvider needs grantUriPermissions");
        }
    }

    /** The file a URI names, if it's one this provider may serve; FileNotFoundException otherwise. */
    private File fileFor(Uri uri) throws FileNotFoundException {
        String path = uri == null ? null : uri.getPath();
        if (path == null || !PATH.matcher(path).matches() || getContext() == null) {
            throw new FileNotFoundException("not a shared picture");
        }
        try {
            File dir = new File(getContext().getCacheDir(), DIR).getCanonicalFile();
            File file = new File(dir, path.substring(DIR.length() + 2)).getCanonicalFile();
            if (!dir.equals(file.getParentFile()) || !file.isFile()) {
                throw new FileNotFoundException("not a shared picture");
            }
            return file;
        } catch (IOException e) {
            throw new FileNotFoundException("not a shared picture");
        }
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) {
            throw new SecurityException("read only");
        }
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "image/png";
    }

    /** Name and size, which share targets ask for before they read the file. */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file;
        try {
            file = fileFor(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        List<String> cols = new ArrayList<String>();
        List<Object> values = new ArrayList<Object>();
        for (String col : projection == null ? COLUMNS : projection) {
            if (OpenableColumns.DISPLAY_NAME.equals(col)) {
                cols.add(col);
                values.add(file.getName());
            } else if (OpenableColumns.SIZE.equals(col)) {
                cols.add(col);
                values.add(file.length());
            }
        }
        MatrixCursor cursor = new MatrixCursor(cols.toArray(new String[0]), 1);
        cursor.addRow(values.toArray());
        return cursor;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("read only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("read only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("read only");
    }
}
