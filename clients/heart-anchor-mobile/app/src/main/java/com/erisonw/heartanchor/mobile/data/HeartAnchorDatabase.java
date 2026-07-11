package com.erisonw.heartanchor.mobile.data;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

@Database(
    entities = {
        FocusPolicyEntity.class,
        UsageDailyEntity.class,
        AuditEventEntity.class,
        PendingResultEntity.class
    },
    version = 1,
    exportSchema = false
)
public abstract class HeartAnchorDatabase extends RoomDatabase {
    private static volatile HeartAnchorDatabase INSTANCE;

    public abstract HeartAnchorDao dao();

    public static HeartAnchorDatabase get(Context context) {
        if (INSTANCE == null) {
            synchronized (HeartAnchorDatabase.class) {
                if (INSTANCE == null) {
                    INSTANCE = Room.databaseBuilder(
                        context.getApplicationContext(),
                        HeartAnchorDatabase.class,
                        "heart-anchor-mobile.sqlite"
                    ).fallbackToDestructiveMigration(true).build();
                }
            }
        }
        return INSTANCE;
    }
}
