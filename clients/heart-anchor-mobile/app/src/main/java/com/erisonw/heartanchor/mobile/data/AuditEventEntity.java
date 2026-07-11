package com.erisonw.heartanchor.mobile.data;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "audit_events")
public class AuditEventEntity {
    @PrimaryKey @NonNull public String eventId = "";
    @NonNull public String type = "";
    @NonNull public String policyId = "";
    @NonNull public String summary = "";
    @NonNull public String detailJson = "{}";
    public long occurredAtEpochMs;
    public boolean synced;
}
