package com.lise.liseidle.presence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Durable {@code player_presence} row &mdash; one per colleague identity (002;
 * data-model.md "PlayerIdentity"; contracts &sect;2). Carries the colleague's
 * identity (displayName, avatar, consent/visibility) and their durable
 * last-seen projection (office, activity, lastSeenAt).
 *
 * <p><b>Bootstrap history (T031 &rarr; T019 &rarr; T033).</b> T031 created this
 * entity with only the natural key {@code colleagueId} so
 * {@code SessionController} could enforce the contracts &sect;2 identity-bound
 * ownership rule via {@code presenceRepository.existsById(playerId)}. T019
 * added the identity / last-seen fields as non-persistent stubs so the
 * round-trip test compiled and stayed RED; T033 (this revision) wires them as
 * real {@code @Column}s ({@code ddl-auto: update} applies the schema delta on
 * the next boot). The {@code colleague_id} key is unchanged throughout, so the
 * T031 identity-bound lookup keeps working.
 *
 * <p>The key is named {@code colleagueId} (column {@code colleague_id}): it is
 * the Keycloak {@code sub} = the social key everywhere = the session
 * {@code playerId} for an identity-bound save (contracts &sect;2 "Identity
 * adoption"), so {@code existsById(playerId)} is the contracts &sect;2
 * identity-bound check verbatim. (T019's informal "player_id" wording refers
 * to this same key.)
 */
@Entity
@Table(name = "player_presence")
public class PlayerPresenceEntity {

    /**
     * The Keycloak {@code sub} = the colleague identity key = the session
     * {@code playerId} for an identity-bound save.
     */
    @Id
    @Column(name = "colleague_id")
    private String colleagueId;

    /** Display name from the access-token claims, refreshed on each authenticated request (data-model PlayerIdentity). */
    @Column(name = "display_name")
    private String displayName;

    /** Assigned avatar sprite id &mdash; deterministic stable hash of colleagueId (data-model PlayerIdentity avatarId). */
    @Column(name = "avatar")
    private String avatar;

    /** Last-known office id the colleague was present in ({@code null} while commuting). */
    @Column(name = "office")
    private String office;

    /** Last-known client-derived activity label (e.g. {@code "coding"}). */
    @Column(name = "activity")
    private String activity;

    /** ISO-8601 server timestamp of the last accepted heartbeat / expiry (FR-006). */
    @Column(name = "last_seen_at")
    private String lastSeenAt;

    /** App-side first-run consent (FR-003); never delegated to Keycloak ({@code GET /api/v1/me} reads this). */
    @Column(name = "consent_given", nullable = false)
    private boolean consentGiven;

    /** Appear/hide toggle (FR-003); a hidden or un-consented colleague is filtered server-side (FR-009). */
    @Column(name = "visible", nullable = false)
    private boolean visible;

    /** No-arg constructor required by JPA. */
    public PlayerPresenceEntity() {
    }

    /**
     * Convenience constructor for the bootstrap key (T031 identity-bound
     * lookup).
     *
     * @param colleagueId the identity key (= session {@code playerId} post-adoption)
     */
    public PlayerPresenceEntity(String colleagueId) {
        this.colleagueId = colleagueId;
    }

    public String getColleagueId() {
        return colleagueId;
    }

    public void setColleagueId(String colleagueId) {
        this.colleagueId = colleagueId;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

    public String getAvatar() {
        return avatar;
    }

    public void setAvatar(String avatar) {
        this.avatar = avatar;
    }

    public String getOffice() {
        return office;
    }

    public void setOffice(String office) {
        this.office = office;
    }

    public String getActivity() {
        return activity;
    }

    public void setActivity(String activity) {
        this.activity = activity;
    }

    public String getLastSeenAt() {
        return lastSeenAt;
    }

    public void setLastSeenAt(String lastSeenAt) {
        this.lastSeenAt = lastSeenAt;
    }

    public boolean isConsentGiven() {
        return consentGiven;
    }

    public void setConsentGiven(boolean consentGiven) {
        this.consentGiven = consentGiven;
    }

    public boolean isVisible() {
        return visible;
    }

    public void setVisible(boolean visible) {
        this.visible = visible;
    }
}
