import { StyleSheet } from 'react-native';
import COLORS from './colors';

export default StyleSheet.create({

    splash: { 
        flex: 1, 
        backgroundColor: COLORS.teal, 
        justifyContent: 'center', 
        alignItems: 'center' 
    },

    splashLogo: { 
        width: 220, 
        height: 220 
    },

    container: { 
        flex: 1, 
        backgroundColor: COLORS.bg, 
        paddingHorizontal: 16, 
        paddingTop: 20 
    },

    header: { 
        alignItems: 'center', 
        marginBottom: 20 
    },

    title: { 
        fontSize: 32, 
        fontWeight: '900', 
        color: COLORS.teal 
    },

    subtitle: { 
        fontSize: 13, 
        color: COLORS.textMuted, 
        letterSpacing: 2, 
        textTransform: 'uppercase', 
        marginTop: 2 
    },

    premiumBadge: { 
        fontSize: 11, 
        color: COLORS.gold, 
        fontWeight: '700', 
        marginTop: 4, 
        backgroundColor: COLORS.teal, 
        paddingHorizontal: 10, 
        paddingVertical: 3, 
        borderRadius: 10 
    },

    input: { 
        backgroundColor: COLORS.white, 
        borderWidth: 1.5, 
        borderColor: COLORS.border, 
        borderRadius: 12, 
        padding: 14, 
        fontSize: 15, 
        color: COLORS.text 
    },

    quickRow: { 
        flexDirection: 'row', 
        flexWrap: 'wrap', 
        marginTop: 12, 
        marginBottom: 4, 
        gap: 8 
    },

    quickChip: { 
        backgroundColor: COLORS.teal, 
        paddingHorizontal: 14, 
        paddingVertical: 8, 
        borderRadius: 20 
    },

    quickChipText: { 
        color: COLORS.gold, 
        fontSize: 13, 
        fontWeight: '600' 
    },

    quickChipOutline: { 
        borderWidth: 1.5, 
        borderColor: COLORS.teal, 
        paddingHorizontal: 12, 
        paddingVertical: 7, 
        borderRadius: 20 
    },

    quickChipOutlineText: { 
        color: COLORS.teal, 
        fontSize: 12, 
        fontWeight: '600' 
    },

    historyPanel: { 
        backgroundColor: COLORS.white, 
        borderRadius: 12, 
        padding: 12, 
        marginBottom: 8, 
        borderWidth: 1, 
        borderColor: COLORS.border 
    },

    historyItem: { 
        paddingVertical: 8, 
        borderBottomWidth: 1, 
        borderBottomColor: COLORS.border 
    },

    historyRoute: { 
        fontSize: 13, 
        fontWeight: '600', 
        color: COLORS.text 
    },

    historyMeta: { 
        fontSize: 11, 
        color: COLORS.textMuted, 
        marginTop: 2 
    },

    filterTitle: { 
        fontSize: 13, 
        fontWeight: '700', 
        color: COLORS.textLight, 
        marginTop: 12, 
        marginBottom: 6 
    },

    checkboxRow: { 
        flexDirection: 'row', 
        flexWrap: 'wrap', 
        marginBottom: 8, 
        gap: 6 
    },

    chip: { 
        paddingHorizontal: 12, 
        paddingVertical: 7, 
        borderRadius: 20, 
        borderWidth: 1.5 
    },

    chipActive: { 
        backgroundColor: COLORS.teal, 
        borderColor: COLORS.teal 
    },

    chipInactive: { 
        backgroundColor: COLORS.white, 
        borderColor: COLORS.border 
    },

    chipText: { 
        fontSize: 11, 
        fontWeight: '600' 
    },

    chipTextActive: { 
        color: COLORS.gold 
    },

    chipTextInactive: { 
        color: COLORS.textLight 
    },

    actionRow: { 
        flexDirection: 'row', 
        marginTop: 4, 
        marginBottom: 16, 
        gap: 8 
    },

    searchBtn: { 
        flex: 1, 
        backgroundColor: COLORS.gold, 
        padding: 14, 
        borderRadius: 10, 
        alignItems: 'center' 
    },

    searchBtnText: { 
        color: COLORS.teal, 
        fontWeight: '800', 
        fontSize: 15 
    },

    radarBtn: { 
        paddingHorizontal: 16, 
        paddingVertical: 14, 
        borderRadius: 10, 
        borderWidth: 1.5, 
        borderColor: COLORS.teal, 
        alignItems: 'center', 
        justifyContent: 'center' 
    },

    radarBtnActive: { 
        backgroundColor: COLORS.teal, 
        borderColor: COLORS.teal 
    },

    radarBtnText: { 
        fontWeight: '700', 
        fontSize: 13, 
        color: COLORS.teal 
    },

    radarBtnTextActive: { 
        color: COLORS.gold 
    },

    alertBox: { 
        backgroundColor: COLORS.alert, 
        borderLeftWidth: 4, 
        borderLeftColor: COLORS.alertBorder, 
        padding: 12, 
        borderRadius: 8, 
        marginBottom: 16 
    },

    alertTitle: { 
        fontSize: 12, 
        fontWeight: '700', 
        color: COLORS.teal, 
        marginBottom: 4 
    },

    alertText: { 
        fontSize: 12, 
        color: COLORS.textLight 
    },

    routeBox: { 
        backgroundColor: COLORS.white, 
        padding: 12, 
        borderRadius: 10, 
        marginBottom: 12, 
        borderWidth: 1, 
        borderColor: COLORS.border 
    },

    routeText: { 
        fontSize: 13, 
        fontWeight: '600', 
        color: COLORS.text, 
        textAlign: 'center' 
    },

    cardRow: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        gap: 10 
    },

    card: { 
        flex: 1, 
        backgroundColor: COLORS.white, 
        borderRadius: 14, 
        padding: 16, 
        borderWidth: 1, 
        borderColor: COLORS.border, 
        shadowColor: COLORS.teal, 
        shadowOffset: { width: 0, height: 4 }, 
        shadowOpacity: 0.06, 
        shadowRadius: 8, 
        elevation: 3 
    },

    cardFull: { 
        backgroundColor: COLORS.white, 
        borderRadius: 14, 
        padding: 18, 
        borderWidth: 1, 
        borderColor: COLORS.border, 
        shadowColor: COLORS.teal, 
        shadowOffset: { width: 0, height: 4 }, 
        shadowOpacity: 0.06, 
        shadowRadius: 8, 
        elevation: 3 
    },

    cardLabel: { 
        fontSize: 10, 
        fontWeight: '700', 
        color: COLORS.textMuted, 
        marginBottom: 6, 
        letterSpacing: 0.5 
    },

    cardPrice: { 
        fontSize: 28, 
        fontWeight: '900', 
        color: COLORS.teal 
    },

    cardProvider: { 
        fontSize: 14, 
        color: COLORS.textLight, 
        fontWeight: '600', 
        marginTop: 2 
    },

    cardCarType: { 
        fontSize: 11, 
        color: COLORS.textMuted, 
        marginTop: 3, 
        fontStyle: 'italic' 
    },

    cardTiming: { 
        fontSize: 11, 
        color: COLORS.textLight, 
        marginTop: 4 
    },

    cardCta: { 
        fontSize: 11, 
        color: COLORS.gold, 
        fontWeight: '700', 
        marginTop: 12 
    },

    upgradeBtn: { 
        backgroundColor: COLORS.teal, 
        padding: 15, 
        borderRadius: 12, 
        alignItems: 'center', 
        position: 'absolute', 
        bottom: 30, 
        left: 16, 
        right: 16, 
        shadowColor: COLORS.teal, 
        shadowOffset: { width: 0, height: 4 }, 
        shadowOpacity: 0.3, 
        shadowRadius: 8, 
        elevation: 6 
    },

    upgradeBtnText: { 
        color: COLORS.gold, 
        fontWeight: '800', 
        fontSize: 15 
    },

    upgradeBtnSub: { 
        color: COLORS.textMuted, 
        fontSize: 11, 
        marginTop: 3 
    },

    modalHeader: { 
        flexDirection: 'row', 
        justifyContent: 'flex-end', 
        paddingHorizontal: 16, 
        paddingVertical: 12, 
        borderBottomWidth: 1, 
        borderBottomColor: COLORS.border 
    },

    modalClose: { 
        fontSize: 16, 
        color: COLORS.textLight, 
        fontWeight: '600' 
    },

    feedbackOverlay: { 
        flex: 1, 
        backgroundColor: 'rgba(29,78,95,0.6)', 
        justifyContent: 'center', 
        padding: 28 
    },

    feedbackContainer: { 
        backgroundColor: COLORS.white, 
        borderRadius: 16, 
        padding: 24, 
        shadowColor: '#000', 
        shadowOffset: { width: 0, height: 8 }, 
        shadowOpacity: 0.15, 
        shadowRadius: 24, 
        elevation: 10 
    },

    feedbackTitle: { 
        fontSize: 18, 
        fontWeight: '800', 
        color: COLORS.teal, 
        marginBottom: 6 
    },

    feedbackSub: { 
        fontSize: 13, 
        color: COLORS.textLight, 
        marginBottom: 18, 
        lineHeight: 18 
    },

    feedbackInputRow: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        borderWidth: 1.5, 
        borderColor: COLORS.border, 
        borderRadius: 10, 
        paddingHorizontal: 12, 
        marginBottom: 20 
    },

    feedbackDollar: { 
        fontSize: 20, 
        fontWeight: '700', 
        color: COLORS.teal, 
        marginRight: 6 
    },

    feedbackInput: { 
        flex: 1, 
        fontSize: 22, 
        fontWeight: '700', 
        color: COLORS.teal, 
        paddingVertical: 10 
    },

    feedbackBtnRow: { 
        flexDirection: 'row', 
        justifyContent: 'flex-end', 
        gap: 10 
    },

    feedbackSkip: { 
        paddingHorizontal: 18, 
        paddingVertical: 10, 
        borderRadius: 8, 
        backgroundColor: COLORS.border 
    },

    feedbackSkipText: { 
        color: COLORS.textLight, 
        fontWeight: '600', 
        fontSize: 14 
    },

    feedbackSubmit: { 
        paddingHorizontal: 22, 
        paddingVertical: 10, 
        borderRadius: 8, 
        backgroundColor: COLORS.teal 
    },

    feedbackSubmitText: { 
        color: COLORS.white, 
        fontWeight: '700', 
        fontSize: 14 
    },

    feedbackNote: { 
        fontSize: 10, 
        color: COLORS.textMuted, 
        textAlign: 'center', 
        marginTop: 14 
    },

});
