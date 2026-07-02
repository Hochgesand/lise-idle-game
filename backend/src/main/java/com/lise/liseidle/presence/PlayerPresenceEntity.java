package com.lise.liseidle.presence;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * <b>Minimal bootstrap of the durable {@code player_presence} row (T031).</b>
 *
 * <p>The full presence package lands in T033 ({@code PresenceRecord},
 * {@code PresenceRegistry}, and <em>this</em> entity extended in place with
 * display name, avatar, office, activity, {@code last_seen_at}, and
 * consent/visibility columns). T031 needs only <i>whether an id has been
 * claimed by an identity</i> to enforce the contracts &sect;2 identity-bound
 * ownership rule in
 * {@code com.lise.liseidle.session.SessionController}, so this entity carries
 * only the natural key {@code colleagueId}. T033 will add the remaining columns
 * here (with {@code ddl-auto: update} Hibernate applies the schema delta on the
 * next boot); nothing about the key changes.
 *
 * <p>The key is named {@code colleagueId} (column {@code colleague_id}) to match
 * the presence domain language (data-model.md "PlayerIdentity", contracts &sect;2
 * {@code PresenceRecord}); it is the <i>same string</i> as the session
 * {@code playerId} for an identity that has adopted its Keycloak {@code sub}
 * (contracts &sect;2 "Identity adoption"), so
 * {@code presenceRepository.existsById(playerId)} is the contracts &sect;2
 * identity-bound check verbatim. (T019's informal "player_id" wording refers to
 * this same key.)
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

    /** No-arg constructor required by JPA. */
    public PlayerPresenceEntity() {
    }

    /**
     * Convenience constructor for the bootstrap key.
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
}
