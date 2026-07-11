package com.erisonw.heartanchor.mobile.data;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "pending_results")
public class PendingResultEntity {
    @PrimaryKey @NonNull public String commandId = "";
    @NonNull public String status = "";
    @NonNull public String resultJson = "{}";
    @NonNull public String error = "";
    public long createdAtEpochMs;
}
