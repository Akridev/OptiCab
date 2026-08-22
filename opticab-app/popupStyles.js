import { StyleSheet } from "react-native";
import COLORS from './colors';

export default popupStyles = StyleSheet.create({

    overlay: { 
        flex: 1, 
        backgroundColor: 'rgba(29,78,95,0.6)', 
        justifyContent: 'center', 
        padding: 28 
    },

    container: { 
        backgroundColor: '#fff', 
        borderRadius: 16, 
        padding: 24, 
        shadowColor: '#000', 
        shadowOffset: { width: 0, height: 8 }, 
        shadowOpacity: 0.15, 
        shadowRadius: 24, 
        elevation: 10 
    },

    title: { 
        fontSize: 18, 
        fontWeight: '800', 
        color: COLORS.teal, 
        marginBottom: 8 
    },

    message: { 
        fontSize: 14, 
        color: COLORS.textLight, 
        lineHeight: 20, 
        marginBottom: 20 
    },

    buttonRow: { 
        flexDirection: 'row', 
        justifyContent: 'flex-end', 
        gap: 10 
    },

    button: { 
        paddingHorizontal: 20, 
        paddingVertical: 10, 
        borderRadius: 8 
    },

    buttonPrimary: { 
        backgroundColor: COLORS.teal 
    },

    buttonCancel: { 
        backgroundColor: COLORS.border 
    },

    buttonText: { 
        color: '#fff', 
        fontWeight: '700', 
        fontSize: 14 
    },

    buttonTextCancel: { 
        color: COLORS.textLight 
    },

});
