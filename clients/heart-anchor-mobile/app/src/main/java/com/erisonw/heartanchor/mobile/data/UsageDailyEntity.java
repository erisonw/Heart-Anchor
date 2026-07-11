package com.erisonw.heartanchor.mobile.data;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "usage_daily")
public class UsageDailyEntity {
    @PrimaryKey @NonNull public String key = "";
    @NonNull public String localDate = "";
    @NonNull public String packageName = "";
    public long foregroundMillis;
    public long updatedAtEpochMs;
}
