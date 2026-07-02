package com.lise.liseidle.presence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;

/**
 * Durable {@code player_presence} row &mdash; one per colleague identity (002;
 * data-model.md "PlayerIdentity"; contracts &sect;2). Carries the colleague's
 * identity (displayName, avatar, consent/visibility) and their durable
 * last-seen projection (office, activity, lastSeenAt).
 *
 * <p><b>STUB (T019 RED).</b> T031 created this entity with only the natural key
 * {@code colleagueId} so {@code SessionController} could enforce the contracts
 * &sect;2 identity-bound ownership rule via
 * {@code presenceRepository.existsById(playerId)}. For T019 the identity /
 * last-seen columns exist only as {@link Transient} fields &mdash; they let the
 * round-trip test <i>compile</i> while keeping it genuinely RED (a
 * non-persistent field does not survive a save&rarr;find, so the round-trip
 * assertions fail). T033 replaces each {@link Transient} with a real
 * {@code @Column} ({@code ddl-auto: update} then creates the columns and the
 * round-trip goes GREEN); the {@code colleague_id} key is persisted here and
 * unchanged, so the T031 identity-bound lookup keeps working.
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

    // ---- STUB fields (T019): @Transient so the round-trip test stays RED until T033 wires @Column. ----

    /** STUB (T019) &rarr; T033: display name from the access-token claims (data-model PlayerIdentity). */
    @Transient
    private String displayName;

    /** STUB (T019) &rarr; T033: assigned avatar sprite id (stable hash of colleagueId). */
    @Transient
    private String avatar;

    /** STUB (T019) &rarr; T033: last-known office id ({@code null} while commuting). */
    @Transient
    private String office;

    /** STUB (T019) &rarr; T033: last-known client-derived activity label. */
    @Transient
    private String activity;

    /** STUB (T019) &rarr; T033: ISO-8601 server timestamp of the last heartbeat / expiry (FR-006). */
    @Transient
    private String lastSeenAt;

    /** STUB (T019) &rarr; T033: app-side first-run consent (FR-003). */
    @Transient
    private boolean consentGiven;

    /** STUB (T019) &rarr; T033: appear/hide toggle (FR-003). */
    @Transient
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
