package com.erisonw.heartanchor.mobile.data;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface HeartAnchorDao {
    @Query("SELECT * FROM focus_policies ORDER BY updatedAtEpochMs DESC")
    List<FocusPolicyEntity> listPolicies();

    @Query("SELECT * FROM focus_policies WHERE state = 'active' AND enabled = 1")
    List<FocusPolicyEntity> listActivePolicies();

    @Query("SELECT * FROM focus_policies WHERE state = 'pending_approval' ORDER BY updatedAtEpochMs DESC")
    List<FocusPolicyEntity> listPendingPolicies();

    @Query("SELECT * FROM focus_policies WHERE policyId = :policyId ORDER BY revision DESC LIMIT 1")
    FocusPolicyEntity findPolicy(String policyId);

    @Query("SELECT * FROM focus_policies WHERE policyId = :policyId AND state = 'pending_approval' ORDER BY revision DESC LIMIT 1")
    FocusPolicyEntity findPendingPolicy(String policyId);

    @Query("SELECT * FROM focus_policies WHERE policyId = :policyId AND state = 'active' ORDER BY revision DESC LIMIT 1")
    FocusPolicyEntity findActivePolicy(String policyId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertPolicy(FocusPolicyEntity policy);

    @Query("UPDATE focus_policies SET state = :state, updatedAtEpochMs = :updatedAt WHERE policyId = :policyId AND revision = :revision")
    void updatePolicyState(String policyId, int revision, String state, long updatedAt);

    @Query("UPDATE focus_policies SET state = 'superseded', updatedAtEpochMs = :updatedAt WHERE policyId = :policyId AND state = 'active' AND revision != :approvedRevision")
    void supersedeActiveRevisions(String policyId, int approvedRevision, long updatedAt);

    @Query("UPDATE focus_policies SET state = 'paused', updatedAtEpochMs = :updatedAt WHERE policyId = :policyId AND state = 'active'")
    void pauseActivePolicy(String policyId, long updatedAt);

    @Query("UPDATE focus_policies SET temporaryUnlockUntilEpochMs = :until, updatedAtEpochMs = :updatedAt WHERE policyId = :policyId AND revision = :revision")
    void updateTemporaryUnlock(String policyId, int revision, long until, long updatedAt);

    @Query("DELETE FROM focus_policies WHERE policyId = :policyId")
    void deletePolicy(String policyId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertUsage(UsageDailyEntity usage);

    @Query("SELECT * FROM usage_daily WHERE localDate = :localDate")
    List<UsageDailyEntity> listUsageForDate(String localDate);

    @Query("SELECT COALESCE(SUM(foregroundMillis), 0) FROM usage_daily WHERE localDate = :localDate AND packageName IN (:packageNames)")
    long sumUsage(String localDate, List<String> packageNames);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void insertAudit(AuditEventEntity event);

    @Query("SELECT * FROM audit_events ORDER BY occurredAtEpochMs DESC LIMIT :limit")
    List<AuditEventEntity> listAudit(int limit);

    @Query("SELECT * FROM audit_events WHERE synced = 0 ORDER BY occurredAtEpochMs ASC LIMIT :limit")
    List<AuditEventEntity> listUnsyncedAudit(int limit);

    @Query("UPDATE audit_events SET synced = 1 WHERE eventId = :eventId")
    void markAuditSynced(String eventId);

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertPendingResult(PendingResultEntity result);

    @Query("SELECT * FROM pending_results ORDER BY createdAtEpochMs ASC")
    List<PendingResultEntity> listPendingResults();

    @Query("DELETE FROM pending_results WHERE commandId = :commandId")
    void deletePendingResult(String commandId);
}
