import React, { useState, useEffect } from "react";
import "./MainPage.css";
import { db } from "./firebase"; // Adjust the path if needed
import { getAuth } from "firebase/auth";
import { collection, query, where, onSnapshot, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const ISLAMIC_QUOTES = [
"So remember Me; I will remember you. And be grateful to Me and do not deny Me. (Quran 2:152)",
"And He found you lost and guided [you], (Quran 93:7)",
"Indeed, with hardship [will be] ease. (Quran 94:6)",
"And do good; indeed, Allāh loves the doers of good.(Quran 2:195)",
"And He is the Forgiving, the Loving, (Quran 85:14)",
"Do not despair of the mercy of Allāh. Indeed, Allāh forgives all sins. Indeed, it is He who is the Forgiving, the Merciful. (Quran 39:53)",
"And Allāh is the best of planners. (Quran 8:30)",
"And He is with you wherever you are. (Quran 57:4)",
"Indeed, He is ever Knowing and Competent.(Quran 35:44)",
"Allāh does not charge a soul except [with that within] its capacity. (Quran 2:286)",
"Except for those who believe and do righteous deeds. For them is a reward uninterrupted. (Quran 84:25)",
"Except for those who have believed and done righteous deeds and advised each other to truth and advised each other to patience. (Quran 103:3)",
"And seek help through patience and prayer, and indeed, it is difficult except for the humbly submissive [to Allah ]. (Quran 2:45)",
"The patient, the true, the obedient, those who spend [in the way of Allah ], and those who seek forgiveness before dawn. (Quran 3:17)",
]; // all daily islamic quotes

function MainPage({ calorieGoal, activityLevel }) {
  const baseGoal = calorieGoal ? Number(calorieGoal) : 2000; // fallback to 2000 if not set
  const activityLabels = {
    sedentary: "Sedentary",
    lightly_active: "Lightly active",
    moderately_active: "Moderately active",
    very_active: "Very active",
    extra_active: "Extra active",
  };
  const activityLabel = activityLabels[activityLevel] || "Not set";
  const [caloriesConsumed, setCaloriesConsumed] = useState(0);
  const [proteinConsumed, setProteinConsumed] = useState(0);
  const [fatConsumed, setFatConsumed] = useState(0);
  const [carbsConsumed, setCarbsConsumed] = useState(0);
  const [streak, setStreak] = useState(0);
  const [quote, setQuote] = useState("");

  useEffect(() => {
    // Pick a random quote on mount
    if (ISLAMIC_QUOTES.length > 0) {
      setQuote(ISLAMIC_QUOTES[Math.floor(Math.random() * ISLAMIC_QUOTES.length)]);
    }
  }, []);

  useEffect(() => {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) { // if user is not authenticated, set initial values
      setCaloriesConsumed(0);
      setProteinConsumed(0);
      setFatConsumed(0);
      setCarbsConsumed(0);
      setStreak(0);
      return;
    }

    // --- STREAK LOGIC START ---
    const userDocRef = doc(db, "users", user.uid);

    async function handleStreak() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        // First login, initialize streak and lastLogin
        await setDoc(userDocRef, {
          streak: 1,
          lastLogin: today
        }, { merge: true });
        setStreak(1);
        return;
      }

      const data = userDoc.data();
      // Firestore Timestamps have a toDate() method, JS Dates do not
      const lastLogin = data.lastLogin && data.lastLogin.toDate
        ? data.lastLogin.toDate()
        : data.lastLogin
          ? new Date(data.lastLogin)
          : null;
      let currentStreak = typeof data.streak === "number" ? data.streak : 0;

      if (!lastLogin) {
        // No lastLogin recorded, initialize
        await updateDoc(userDocRef, {
          streak: 1,
          lastLogin: today
        });
        setStreak(1);
        return;
      }

      // Calculate difference in days
      const diffTime = today.getTime() - lastLogin.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Consecutive day
        currentStreak += 1;
        await updateDoc(userDocRef, {
          streak: currentStreak,
          lastLogin: today
        });
        setStreak(currentStreak);
      } else if (diffDays > 1) {
        // Missed a day, reset streak
        await updateDoc(userDocRef, {
          streak: 0,
          lastLogin: today
        });
        setStreak(0);
      } else {
        // Same day login, streak unchanged
        setStreak(currentStreak);
      }
    }

    handleStreak();
    // --- STREAK LOGIC END ---

    // Get start and end of the current day
    const currentDate = new Date();
    const start = new Date(currentDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(currentDate);
    end.setHours(23, 59, 59, 999);

    // Query Firestore for food logs within the current day
    const foodsRef = collection(db, "users", user.uid, "foods");
    const q = query(
      foodsRef,
      where("timestamp", ">=", start),
      where("timestamp", "<=", end)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let totalCalories = 0;
      let totalProtein = 0;
      let totalFat = 0;
      let totalCarbs = 0;

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();

        // Sum up calories
        if (data.nf_calories !== undefined) {
          totalCalories += Math.round(data.nf_calories);
        } else if (data.details) {
          const match = data.details.match(/(\d+)\s*calories/i);
          if (match) {
            totalCalories += parseInt(match[1], 10);
          }
        }

        // Sum up macros
        totalProtein += data.protein || 0;
        totalFat += data.fat || 0;
        totalCarbs += data.carbs || 0;
      });

      setCaloriesConsumed(totalCalories);
      setProteinConsumed(totalProtein);
      setFatConsumed(totalFat);
      setCarbsConsumed(totalCarbs);
    });

    return () => unsubscribe();
  }, []);

  const remainingCalories = baseGoal - caloriesConsumed;

  return (
    <div className="main-page">
      <div className="main-header">
        <div className="date-controls">
          <h2 className="date-title">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric"
            })}
          </h2>
        </div>
        <div className="streak-card">
          <span className="streak-label">DAY STREAK</span>
          <span className="streak-value">{streak}</span>
        </div>
      </div>
      <div className="cards">
        <div className="card">
          <h3>Calories</h3>
          <div className="calories-container">
            {/* Left: Calories Remaining */}
            <div className="calories-circle">
              <span className="calories-amount">{remainingCalories}</span>
              <p className="label">Remaining</p>
            </div>

            {/* Right: Base Goal and Food */}
            <div className="calories-details">
              <div>
                <strong>Base Goal:</strong> {baseGoal} cal
              </div>
              <div>
                <strong>Activity Level:</strong> {activityLabel}
              </div>
              <div>
                <strong>Consumed:</strong> {caloriesConsumed} cal
              </div>
            </div>
          </div>
        </div>

        <div className="card macros-card">
          <h3>Macros</h3>
          <div className="macros-details">
            <div className="macro-item">
              <span className="macro-label">Protein:</span>
              <span className="macro-value">{proteinConsumed}g consumed</span>
            </div>
            <div className="macro-item">
              <span className="macro-label">Carbs:</span>
              <span className="macro-value">{carbsConsumed}g consumed</span>
            </div>
            <div className="macro-item">
              <span className="macro-label">Fat:</span>
              <span className="macro-value">{fatConsumed}g consumed</span>
            </div>
          </div>
        </div>
      </div>

      <div className="quote-section">
        <h4>Daily Islamic Quote</h4>
        <blockquote>
          {quote || "The world is but a moment, so make it a moment of obedience."}
        </blockquote>
      </div>
    </div>
  );
}

export default MainPage;